// AdsPilot — Google Ads for agencies. Its own app, at ads.pilotworks4u.com, beside DevPilot (dev.) and SEOPilot (seo.).
//
// Built from SEOPilot's foundation rather than inside it: the leaf modules (vault, auth, ai/engines, mail, cost) are copies, and the Ads
// modules (lib/gads.js, lib/ads*.js, routes/ads.js) are the ones first written for SEOPilot on 2026-11-21 and moved here the same day on
// the owner's word: "adspilot separate tool h". Read CLAUDE.md before changing anything; it says what is and is not verified.
//
// This file: sessions and workspaces, projects (one Google Ads account each), the Google sign-in, the platform admin's settings, the work
// queue and alerts reads, the timer, and the built web app. Everything Ads-specific is in routes/ads.js.

import "./lib/loadenv.js";
import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import * as db from "./lib/store.js";
import * as google from "./lib/google.js";
import * as gads from "./lib/gads.js";
import * as ai from "./lib/ai.js";
import * as mail from "./lib/mail.js";
import * as cost from "./lib/cost.js";
import { hashPassword, verifyPassword, newSessionToken, hashToken, normEmail, validateSignup, safeEqual } from "./lib/auth.js";
import { keySource } from "./lib/vault.js";
import { mountAds } from "./routes/ads.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4020;
const APP_URL = (process.env.AP_APP_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");
const SIGNUP_OPEN = String(process.env.AP_SIGNUP || "").toLowerCase() === "open";
const SETUP_KEY = String(process.env.AP_SETUP_KEY || "");
const COMMIT = (process.env.AP_COMMIT || "").slice(0, 12);
const SESSION_COOKIE = "ap_sess";
const COOKIE_OPTS = { httpOnly: true, sameSite: "lax", secure: APP_URL.startsWith("https://"), maxAge: 30 * 86_400_000, path: "/" };
const AI_DAILY_LIMIT = (() => {
  const v = String(process.env.AP_AI_DAILY_LIMIT ?? "30").toLowerCase();
  return v === "0" || v === "off" ? 0 : Number(v) || 30;
})();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));

const ok = (res, data = {}) => res.json({ ok: true, ...data });
const fail = (res, e, code = 400) => res.status(code).json({ ok: false, error: e?.message || String(e) });

/* ------------------------------------------------------------------ who is asking */

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || "")
    .split(";")
    .forEach((c) => {
      const i = c.indexOf("=");
      if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
    });
  return out;
}
function resolveAuth(req) {
  const raw = parseCookies(req)[SESSION_COOKIE];
  if (!raw) return null;
  const s = db.sessionByHash(hashToken(raw));
  if (!s) return null;
  const user = db.getUser(s.user_id);
  const org = db.getOrg(s.org_id);
  const mem = user && org ? db.membershipOf(user.id, org.id) : null;
  if (!mem) return null;
  db.touchSession(s.id);
  return { user: db.publicUser(user), org, role: mem.role, platformAdmin: db.isPlatformAdmin(user.id) };
}

/** The workspace an AI run is for, so the daily allowance below can count it without every route passing it through. */
const actor = new AsyncLocalStorage();
ai.setAiGate(async () => {
  const a = actor.getStore();
  if (!AI_DAILY_LIMIT || !a?.orgId || a.exempt) return;
  if (db.aiRunsSince(a.orgId, Date.now() - 86_400_000) >= AI_DAILY_LIMIT) {
    throw new Error(`This workspace has used its ${AI_DAILY_LIMIT} AI runs for the last 24 hours. It frees up as older runs pass the 24-hour mark. Everything else keeps working.`);
  }
});

function requireAdmin(req) {
  if (req.auth.role !== "owner" && req.auth.role !== "admin") throw new Error("Only the workspace owner or an admin can do that.");
}
/** Answers "Not found", never "Forbidden": a workspace owner should not learn the admin surface exists (SEOPilot's rule). */
function requirePlatformAdmin(req) {
  if (!req.auth.platformAdmin) throw new Error("Not found.");
}

/* ------------------------------------------------------------------ public routes */

app.get("/api/health", (_req, res) => ok(res, { app: "adspilot", commit: COMMIT, store: "local JSON file" }));

app.get("/api/auth", (req, res) => {
  const a = resolveAuth(req);
  ok(res, { accounts: db.listUsers().length > 0, setupKeyRequired: db.listUsers().length === 0 && !!SETUP_KEY, signupOpen: SIGNUP_OPEN || db.listUsers().length === 0, authed: !!a, user: a?.user || null, org: a ? { id: a.org.id, name: a.org.name, role: a.role } : null, platformAdmin: !!a?.platformAdmin });
});

/** The first account ever made owns the install. After that, signing up is open only with AP_SIGNUP=open. */
app.post("/api/register", async (req, res) => {
  try {
    const first = db.listUsers().length === 0;
    if (!first && !SIGNUP_OPEN) throw new Error("Sign-up is closed on this install. Ask the workspace owner to add you.");
    // On a public URL the first account runs the install (Google client, developer token). AP_SETUP_KEY proves the person creating it is
    // the person who deployed it; without it, whoever finds the address first owns the install. Used once, then never again.
    if (first && SETUP_KEY && !safeEqual(String(req.body?.setupKey || ""), SETUP_KEY)) throw new Error("This install needs its setup key to create the first account (AP_SETUP_KEY on the server).");
    const b = req.body || {};
    const email = normEmail(b.email);
    const problem = validateSignup({ email, password: b.password, name: b.name });
    if (problem) throw new Error(problem);
    if (db.userByEmail(email)) throw new Error("An account with that email already exists. Sign in instead.");
    const user = db.createUser({ email, name: String(b.name || "").slice(0, 80), passwordHash: await hashPassword(String(b.password)) });
    const org = db.createOrg(b.workspace || `${b.name || email}'s workspace`);
    db.addMembership(user.id, org.id, "owner");
    const { token, hash } = newSessionToken();
    db.createSession({ userId: user.id, orgId: org.id, tokenHash: hash });
    res.cookie(SESSION_COOKIE, token, COOKIE_OPTS);
    db.logActivity("account", "Workspace created", email, org.id);
    ok(res, { user: db.publicUser(user) });
  } catch (e) {
    fail(res, e);
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const user = db.userByEmail(normEmail(req.body?.email));
    // The same answer whether the address exists or not: a login form must not tell a stranger who has an account.
    if (!user || !(await verifyPassword(String(req.body?.password || ""), user.password_hash))) throw new Error("That email and password don't match.");
    const mem = db.orgsOf(user.id)[0];
    if (!mem) throw new Error("This account is not in any workspace any more.");
    const { token, hash } = newSessionToken();
    db.createSession({ userId: user.id, orgId: mem.org_id, tokenHash: hash });
    res.cookie(SESSION_COOKIE, token, COOKIE_OPTS);
    ok(res, { user: db.publicUser(user) });
  } catch (e) {
    fail(res, e);
  }
});

app.post("/api/logout", (req, res) => {
  const raw = parseCookies(req)[SESSION_COOKIE];
  if (raw) db.deleteSession(hashToken(raw));
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  ok(res);
});

/* ------------------------------------------------------------------ the Google OAuth callback (a browser redirect, not JSON) */

const pendingOAuth = new Map(); // state → { projectId, orgId, at }
const OAUTH_TTL = 15 * 60_000;

app.get("/oauth/google/callback", async (req, res) => {
  const pending = pendingOAuth.get(String(req.query.state || ""));
  pendingOAuth.delete(String(req.query.state || ""));
  const back = (q) => res.redirect(`/app/accounts/${pending?.projectId || ""}?${new URLSearchParams(q).toString()}`);
  try {
    if (!pending || Date.now() - pending.at > OAUTH_TTL) return res.redirect("/app?google=error&reason=" + encodeURIComponent("That sign-in link expired. Start again."));
    if (req.query.error) return back({ google: "error", reason: `Google said: ${req.query.error}` });
    const cfg = db.googleConfig();
    const tokens = await google.exchangeCode({ code: req.query.code, clientId: cfg.clientId, clientSecret: cfg.clientSecret, appUrl: APP_URL });
    if (!google.grantedAds(tokens.scope)) return back({ google: "error", reason: google.ADS_REFUSED });
    const who = await google.userInfo(tokens.access_token).catch(() => ({}));
    let properties = [];
    let listError = "";
    try {
      const g = db.gadsConfig();
      properties = await gads.listAccounts({ accessToken: tokens.access_token, developerToken: g.developerToken, version: g.version || undefined });
    } catch (e) {
      // The grant is real, so it is stored either way; the reason the list is empty is kept, or the screen shows an empty picker and nothing.
      listError = e.message;
    }
    db.setProjectConnection(pending.projectId, "gads", {
      email: who.email || "",
      scope: tokens.scope || "",
      refreshToken: tokens.refresh_token || "",
      accessToken: tokens.access_token,
      expiresAt: new Date(Date.now() + (Number(tokens.expires_in) || 3600) * 1000).toISOString(),
      properties,
      listError,
      // A new sign-in starts read-only again, whatever the old one allowed.
      config: null,
    });
    db.logActivity("google", "Google Ads connected", who.email || "", pending.orgId);
    return back(tokens.warning ? { google: "warning", reason: tokens.warning } : { google: "connected" });
  } catch (e) {
    return back({ google: "error", reason: e.message });
  }
});

/* ------------------------------------------------------------------ everything below needs a session */

app.use("/api", (req, res, next) => {
  const a = resolveAuth(req);
  if (!a) return fail(res, new Error("Unauthorized"), 401);
  req.auth = a;
  actor.run({ orgId: a.org.id, exempt: a.platformAdmin }, next);
});

/* --- workspace and people --- */

app.get("/api/members", (req, res) => ok(res, { members: db.membersOf(req.auth.org.id), role: req.auth.role }));

/** No email invites (there may be no mail set up): the owner sets the first password and hands it over, like SEOPilot. */
app.post("/api/members", async (req, res) => {
  try {
    requireAdmin(req);
    const b = req.body || {};
    const email = normEmail(b.email);
    const role = ["admin", "member"].includes(b.role) ? b.role : "member";
    let user = db.userByEmail(email);
    if (!user) {
      const problem = validateSignup({ email, password: b.password, name: b.name });
      if (problem) throw new Error(problem);
      user = db.createUser({ email, name: String(b.name || "").slice(0, 80), passwordHash: await hashPassword(String(b.password)) });
    }
    if (db.membershipOf(user.id, req.auth.org.id)) throw new Error("That person is already in this workspace.");
    db.addMembership(user.id, req.auth.org.id, role);
    ok(res, { members: db.membersOf(req.auth.org.id) });
  } catch (e) {
    fail(res, e);
  }
});

app.post("/api/members/:uid/remove", (req, res) => {
  try {
    requireAdmin(req);
    const m = db.membershipOf(req.params.uid, req.auth.org.id);
    if (!m) throw new Error("No such member.");
    if (m.role === "owner") throw new Error("The owner cannot be removed.");
    db.removeMember(req.params.uid, req.auth.org.id);
    ok(res, { members: db.membersOf(req.auth.org.id) });
  } catch (e) {
    fail(res, e);
  }
});

/** Where alerts are emailed. On the WORKSPACE, never per account: an alert is the agency's business, not its client's (SEOPilot's rule). */
app.post("/api/alert-emails", (req, res) => {
  try {
    requireAdmin(req);
    const list = mail.validRecipients(String(req.body?.emails || "").split(/[\s,;]+/));
    db.setAlertEmails(req.auth.org.id, list);
    ok(res, { emails: list });
  } catch (e) {
    fail(res, e);
  }
});

/* --- ad accounts ("projects") --- */

const projectRow = (p) => {
  const c = db.getProjectConnection(p.id, "gads");
  const chosen = c?.config?.property ? (c.properties || []).find((x) => x.property === c.config.property) : null;
  return { ...p, connected: !!c, account: c?.config?.property || "", accountName: chosen?.name || "", writesAllowed: c?.config?.writesAllowed === true };
};

app.get("/api/projects", (req, res) => ok(res, { projects: db.listProjects(req.auth.org.id).map(projectRow), emailOn: mail.isConfigured(), alertEmails: db.getOrg(req.auth.org.id)?.alert_emails || [] }));

app.post("/api/projects", (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) throw new Error("Give the client a name.");
    const p = db.createProject({ orgId: req.auth.org.id, name });
    db.logActivity("account", `Added ${name}`, "", req.auth.org.id);
    ok(res, { project: projectRow(p) });
  } catch (e) {
    fail(res, e);
  }
});

app.post("/api/projects/:id/rename", (req, res) => {
  try {
    const p = db.updateProject(req.params.id, req.auth.org.id, { name: String(req.body?.name || "").trim() || undefined, domain: req.body?.domain });
    if (!p) throw new Error("No such project.");
    ok(res, { project: projectRow(p) });
  } catch (e) {
    fail(res, e);
  }
});

app.post("/api/projects/:id/delete", (req, res) => {
  try {
    requireAdmin(req);
    if (req.body?.confirm !== true) throw new Error("Confirm first. This removes the client, its sync history and its change journal from AdsPilot (nothing in Google Ads is touched).");
    if (!db.deleteProject(req.params.id, req.auth.org.id)) throw new Error("No such project.");
    ok(res);
  } catch (e) {
    fail(res, e);
  }
});

/* --- the Google sign-in for one project --- */

app.get("/api/projects/:id/google/connect", (req, res) => {
  try {
    const p = db.getProject(req.params.id, req.auth.org.id);
    if (!p) throw new Error("No such project.");
    const cfg = db.googleConfig();
    if (!google.isConfigured(cfg)) throw new Error("Google sign-in is not set up on this install yet: the platform admin adds the Google OAuth client under Admin.");
    const state = crypto.randomBytes(16).toString("hex");
    for (const [k, v] of pendingOAuth) if (Date.now() - v.at > OAUTH_TTL) pendingOAuth.delete(k);
    pendingOAuth.set(state, { projectId: p.id, orgId: req.auth.org.id, at: Date.now() });
    ok(res, { url: google.authUrl({ clientId: cfg.clientId, appUrl: APP_URL, state }) });
  } catch (e) {
    fail(res, e);
  }
});

/** Re-read the list of accounts without signing in again (after the developer token is added, say). */
app.post("/api/projects/:id/google/accounts", async (req, res) => {
  try {
    const p = db.getProject(req.params.id, req.auth.org.id);
    if (!p) throw new Error("No such project.");
    if (!db.getProjectConnection(p.id, "gads")) throw new Error("Connect Google Ads first.");
    const g = db.gadsConfig();
    try {
      const properties = await gads.listAccounts({ accessToken: await accessTokenFor(p.id), developerToken: g.developerToken, version: g.version || undefined });
      db.setProjectConnection(p.id, "gads", { properties, listError: "" });
    } catch (e) {
      db.setProjectConnection(p.id, "gads", { listError: e.message });
      throw e;
    }
    ok(res, { project: projectRow(db.getProject(p.id, req.auth.org.id)) });
  } catch (e) {
    fail(res, e);
  }
});

/**
 * Point the project at one account, chosen only from the list that Google sign-in returned. Replacing `config` also switches changes OFF:
 * a permission given for one ad account must never follow the project to another.
 */
app.post("/api/projects/:id/google/account", (req, res) => {
  try {
    const p = db.getProject(req.params.id, req.auth.org.id);
    if (!p) throw new Error("No such project.");
    const c = db.getProjectConnection(p.id, "gads");
    if (!c) throw new Error("Connect Google Ads first.");
    const wanted = String(req.body?.property || "");
    const row = (c.properties || []).find((x) => x.property === wanted);
    if (!row) throw new Error("Pick one of the accounts that Google sign-in can open.");
    if (row.error) throw new Error(`That account could not be read: ${row.error}`);
    db.setProjectConnection(p.id, "gads", { config: { property: wanted } });
    db.logActivity("google", `${p.name} — pointed at a Google Ads account`, row.name, req.auth.org.id);
    ok(res, { project: projectRow(db.getProject(p.id, req.auth.org.id)) });
  } catch (e) {
    fail(res, e);
  }
});

app.post("/api/projects/:id/google/disconnect", (req, res) => {
  try {
    requireAdmin(req);
    const p = db.getProject(req.params.id, req.auth.org.id);
    if (!p) throw new Error("No such project.");
    db.clearProjectConnection(p.id, "gads");
    db.logActivity("google", `${p.name} — Google Ads disconnected`, "", req.auth.org.id);
    ok(res, { project: projectRow(p) });
  } catch (e) {
    fail(res, e);
  }
});

/** A fresh access token for the project's own Google sign-in. There is no install-wide fallback: an ad account is money. */
async function accessTokenFor(projectId) {
  const cfg = db.googleConfig();
  if (!google.isConfigured(cfg)) throw new Error("Google sign-in is not set up on this install yet.");
  const c = db.getProjectConnection(projectId, "gads", { withSecrets: true });
  if (!c) throw new Error("Connect Google Ads first.");
  if (c.access_token && c.expires_at && Date.parse(c.expires_at) - Date.now() > 60_000) return c.access_token;
  if (!c.refresh_token) throw new Error("This Google sign-in has no refresh token. Disconnect and connect again.");
  const t = await google.refreshAccess({ refreshToken: c.refresh_token, clientId: cfg.clientId, clientSecret: cfg.clientSecret });
  db.setProjectConnection(projectId, "gads", { accessToken: t.access_token, expiresAt: new Date(Date.now() + (Number(t.expires_in) || 3600) * 1000).toISOString() });
  return t.access_token;
}

/* --- the queue and alerts (read and mark) --- */

app.get("/api/actions", (req, res) => ok(res, { actions: db.listActions(req.auth.org.id, req.query.project ? String(req.query.project) : null) }));
app.post("/api/actions/:id", (req, res) => {
  try {
    ok(res, { action: db.setActionStatus(req.params.id, req.auth.org.id, String(req.body?.status || "")) });
  } catch (e) {
    fail(res, e);
  }
});
app.get("/api/alerts", (req, res) => ok(res, { alerts: db.listAlerts(req.auth.org.id), emailOn: mail.isConfigured(), whyNoEmail: mail.isConfigured() ? "" : mail.whyNotConfigured() }));
app.post("/api/alerts/:id/ack", (req, res) => {
  try {
    ok(res, { alert: db.acknowledgeAlert(req.params.id, req.auth.org.id) });
  } catch (e) {
    fail(res, e);
  }
});
app.get("/api/activity", (req, res) => ok(res, { activity: db.listActivity(req.auth.org.id) }));

/* --- platform admin: the Google OAuth client and the AI engine status --- */

app.get("/api/admin/google", (req, res) => {
  try {
    requirePlatformAdmin(req);
    const c = db.googleConfig();
    ok(res, { clientId: c.clientId, hasSecret: !!c.clientSecret, fromEnv: c.fromEnv, redirectUri: google.redirectUri(APP_URL), ai: ai.engineStatus?.() || null, aiLimit: AI_DAILY_LIMIT });
  } catch (e) {
    fail(res, e);
  }
});
app.post("/api/admin/google", (req, res) => {
  try {
    requirePlatformAdmin(req);
    if (db.googleConfig().fromEnv) throw new Error("The Google client is set from the environment (AP_GOOGLE_CLIENT_ID / AP_GOOGLE_CLIENT_SECRET). Change it there.");
    db.setGoogleConfig({ clientId: req.body?.clientId, clientSecret: req.body?.clientSecret });
    db.logActivity("admin", "Updated the Google OAuth client", "", req.auth.org.id);
    const c = db.googleConfig();
    ok(res, { clientId: c.clientId, hasSecret: !!c.clientSecret, fromEnv: c.fromEnv, redirectUri: google.redirectUri(APP_URL) });
  } catch (e) {
    fail(res, e);
  }
});

/* --- Ads: findings, proposals, journal, copy, ask, the developer token --- */

function costOfAnswer(asked) {
  if (typeof asked.costUsd === "number") return asked.costUsd;
  if (!asked.usage) return null;
  const c = cost.costOf(asked.model, asked.usage);
  return c.unknown ? null : c.usd;
}

/** Email the alerts just raised. Nothing is queued when email is off (SEOPilot's rule): the alert screen says so instead. */
async function deliverAlerts(orgId, list) {
  const to = mail.validRecipients(db.getOrg(orgId)?.alert_emails || []);
  if (!to.length || !mail.isConfigured()) return;
  for (const a of list) {
    const p = db.getProject(a.project_id, orgId);
    const msg = mail.renderAlertEmail({ alert: a, project: p, url: `${APP_URL}/app/accounts/${a.project_id}` });
    try {
      await mail.send({ to, ...msg });
      db.markAlertNotified(a.id);
    } catch (e) {
      db.markAlertNotified(a.id, { error: e.message });
    }
  }
}

const ads = mountAds(app, { db, ok, fail, ai, costOfAnswer, accessTokenFor: (pid) => accessTokenFor(pid), requireAdmin, requirePlatformAdmin, deliverAlerts });

app.use("/api", (_req, res) => fail(res, new Error("No such route."), 404));

/* ------------------------------------------------------------------ the web app */

const WEB = join(__dirname, "..", "web", "dist");
if (existsSync(WEB)) {
  app.use(express.static(WEB, { index: false }));
  app.get(["/", "/app", "/app/*"], (_req, res) => res.sendFile(join(WEB, "index.html")));
}

/* ------------------------------------------------------------------ start */

const server = app.listen(PORT, () => {
  // The timer: every account not synced for 20 hours, one at a time (routes/ads.js). Not in the first seconds after a restart.
  setTimeout(() => void ads.tick(), 120_000).unref?.();
  setInterval(() => void ads.tick(), 3 * 3_600_000).unref?.();
  console.log(`\n  AdsPilot  →  ${APP_URL}/app${COMMIT ? `  (${COMMIT})` : ""}`);
  console.log(`  Data      : ${db.DATA_DIR}  (vault key: ${keySource() === "env" ? "AP_MASTER_KEY" : "file next to the database"})`);
  console.log(`  Google    : ${google.isConfigured(db.googleConfig()) ? "OAuth client configured" : "not configured — Admin explains how"}`);
  console.log(`  Ads token : ${db.gadsConfig().hasToken ? "set" : "not set — Admin → Google Ads"}`);
  console.log(`  Email     : ${mail.isConfigured() ? `on (${mail.engineName()})` : `off — ${mail.whyNotConfigured()}`}`);
  if (!existsSync(WEB)) console.log("  UI        : not built yet — run `npm run build`");
});

// Flush the debounced save before exiting, or the last few seconds of writes are lost on every deploy.
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    db.flush();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref?.();
  });
}
