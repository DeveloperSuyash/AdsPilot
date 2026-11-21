// lib/store.js — AdsPilot's data, in one JSON file (AP_DATA_DIR/db.json), saved atomically (temp file + rename) and debounced.
//
// Deliberately small. SEOPilot's store is 2,800 lines because it carries every SEO feature; this carries accounts, sessions, workspaces,
// projects (one Google Ads account each), connections, snapshots ("blobs"), the work queue, alerts, the activity log and the AI usage
// ledger. The rules for the queue and the alerts are SEOPilot's, copied in behaviour (see the comments where they apply), because an agency
// using both products must find the two lists behaving the same way.
//
// One process only. Two processes on one db.json do not clash noisily: the stale one writes its boot-time copy over everything the other
// did. DevPilot paid for that lesson; SEOPilot's Postgres store has a writer lease for it. When this store moves to Postgres, port that
// lease with it (SEOPilot's lib/store.js, "writer lease").
//
// Secrets (Google refresh/access tokens, the OAuth client secret, the Ads developer token) are SEALED with lib/vault.js before they are
// stored, and never returned by a public read.

import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { seal, open as unseal } from "./vault.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.AP_DATA_DIR || join(__dirname, "..", "data");
const FILE = join(DATA_DIR, "db.json");

const now = () => new Date().toISOString();
const id = (p) => `${p}_${crypto.randomBytes(6).toString("hex")}`;

const EMPTY = () => ({ version: 1, users: [], sessions: [], orgs: [], memberships: [], projects: [], connections: [], blobs: [], actions: [], alerts: [], activity: [], aiUsage: [], settings: {} });

let d = null;
function init() {
  if (d) return d;
  mkdirSync(DATA_DIR, { recursive: true });
  d = existsSync(FILE) ? { ...EMPTY(), ...JSON.parse(readFileSync(FILE, "utf8")) } : EMPTY();
  return d;
}

let timer = null;
export function flush() {
  if (!d) return;
  if (timer) clearTimeout(timer);
  timer = null;
  const tmp = `${FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(d));
  renameSync(tmp, FILE);
}
function save() {
  if (timer) return;
  timer = setTimeout(flush, 200);
  timer.unref?.();
}

/* ------------------------------------------------------------------ users, workspaces, sessions */

export const listUsers = () => init().users.slice();
export const getUser = (uid) => init().users.find((u) => u.id === uid) || null;
export const userByEmail = (email) => init().users.find((u) => u.email === email) || null;
export const publicUser = (u) => (u ? { id: u.id, email: u.email, name: u.name } : null);
/** The first account ever made runs the install (the developer token, the Google client). Nobody else can become it. */
export const isPlatformAdmin = (uid) => init().users[0]?.id === uid;

export function createUser({ email, name, passwordHash }) {
  const u = { id: id("usr"), email, name: name || "", password_hash: passwordHash, created_at: now() };
  init().users.push(u);
  save();
  return u;
}
export function createOrg(name) {
  const o = { id: id("org"), name: String(name || "My workspace").slice(0, 80), created_at: now(), alert_emails: [] };
  init().orgs.push(o);
  save();
  return o;
}
export const getOrg = (oid) => init().orgs.find((o) => o.id === oid) || null;
export function addMembership(userId, orgId, role) {
  init().memberships.push({ user_id: userId, org_id: orgId, role, created_at: now() });
  save();
}
export const membershipOf = (uid, oid) => init().memberships.find((m) => m.user_id === uid && m.org_id === oid) || null;
export const orgsOf = (uid) => init().memberships.filter((m) => m.user_id === uid);
export const membersOf = (oid) =>
  init()
    .memberships.filter((m) => m.org_id === oid)
    .map((m) => ({ ...publicUser(getUser(m.user_id)), role: m.role }));
export function removeMember(uid, oid) {
  const db = init();
  db.memberships = db.memberships.filter((m) => !(m.user_id === uid && m.org_id === oid));
  // Removing somebody ends their sessions in the same breath (SEOPilot's rule): the cookie would otherwise outlive the membership.
  db.sessions = db.sessions.filter((s) => !(s.user_id === uid && s.org_id === oid));
  save();
}

/** Only the hash of a session token is stored, so a copied db.json holds no working cookie. */
export function createSession({ userId, orgId, tokenHash }) {
  init().sessions.push({ id: id("ses"), user_id: userId, org_id: orgId, token_hash: tokenHash, created_at: now(), touched_at: now() });
  save();
}
const SESSION_DAYS = 30;
export function sessionByHash(hash) {
  const s = init().sessions.find((x) => x.token_hash === hash);
  if (!s) return null;
  if (Date.now() - Date.parse(s.touched_at) > SESSION_DAYS * 86_400_000) return null;
  return s;
}
export function touchSession(sid) {
  const s = init().sessions.find((x) => x.id === sid);
  if (s && Date.now() - Date.parse(s.touched_at) > 3_600_000) {
    s.touched_at = now();
    save();
  }
}
export function deleteSession(hash) {
  const db = init();
  db.sessions = db.sessions.filter((s) => s.token_hash !== hash);
  save();
}

/* ------------------------------------------------------------------ projects: one Google Ads account each */

export function createProject({ orgId, name }) {
  const p = { id: id("prj"), org_id: orgId, name: String(name || "").slice(0, 120), domain: "", created_at: now() };
  init().projects.push(p);
  save();
  return p;
}
/** Scoped to a workspace whenever `orgId` is given — every route passes it. Only the timer reads across workspaces. */
export const getProject = (pid, orgId) => init().projects.find((p) => p.id === pid && (orgId === undefined || p.org_id === orgId)) || null;
export const listProjects = (orgId) => init().projects.filter((p) => p.org_id === orgId);
export const listAllProjects = () => init().projects.slice();
export function updateProject(pid, orgId, patch) {
  const p = getProject(pid, orgId);
  if (!p) return null;
  if (patch.name !== undefined) p.name = String(patch.name).slice(0, 120);
  if (patch.domain !== undefined) p.domain = String(patch.domain).slice(0, 200);
  save();
  return p;
}
export function deleteProject(pid, orgId) {
  const db = init();
  if (!getProject(pid, orgId)) return false;
  db.projects = db.projects.filter((p) => p.id !== pid);
  db.connections = db.connections.filter((c) => c.project_id !== pid);
  db.blobs = db.blobs.filter((b) => b.project_id !== pid);
  db.actions = db.actions.filter((a) => a.project_id !== pid);
  db.alerts = db.alerts.filter((a) => a.project_id !== pid);
  save();
  return true;
}

/* ------------------------------------------------------------------ connections (the Google sign-in per project) */

const connRow = (pid, kind) => init().connections.find((c) => c.project_id === pid && c.kind === kind) || null;
const publicConn = (c) => ({ project_id: c.project_id, kind: c.kind, email: c.email, scope: c.scope, connected_at: c.connected_at, properties: c.properties || [], config: c.config || null, list_error: c.list_error || "" });

export function getProjectConnection(pid, kind, { withSecrets = false } = {}) {
  const c = connRow(pid, kind);
  if (!c) return null;
  return withSecrets ? { ...publicConn(c), refresh_token: unseal(c.refresh_token), access_token: unseal(c.access_token), expires_at: c.expires_at } : publicConn(c);
}
export function setProjectConnection(pid, kind, { email, scope, refreshToken, accessToken, expiresAt, properties, config, listError }) {
  const db = init();
  const prev = connRow(pid, kind);
  const row = {
    project_id: pid,
    kind,
    email: email ?? prev?.email ?? "",
    scope: scope ?? prev?.scope ?? "",
    // A refresh answer carries no refresh token; overwriting the stored one with nothing would disconnect the project silently.
    refresh_token: refreshToken ? seal(refreshToken) : prev?.refresh_token || "",
    access_token: accessToken ? seal(accessToken) : prev?.access_token || "",
    expires_at: expiresAt ?? prev?.expires_at ?? null,
    connected_at: prev?.connected_at || now(),
    properties: properties ?? prev?.properties ?? [],
    config: config === undefined ? prev?.config ?? null : config,
    list_error: listError ?? prev?.list_error ?? "",
  };
  if (prev) Object.assign(prev, row);
  else db.connections.push(row);
  save();
  return getProjectConnection(pid, kind);
}
export function clearProjectConnection(pid, kind) {
  const db = init();
  db.connections = db.connections.filter((c) => !(c.project_id === pid && c.kind === kind));
  save();
}

/* ------------------------------------------------------------------ blobs: snapshots outside the records */

export async function saveBlob({ projectId, kind, data, keep = 2 }) {
  const db = init();
  db.blobs.push({ id: id("blob"), project_id: projectId, kind, at: now(), data });
  const mine = db.blobs.filter((b) => b.project_id === projectId && b.kind === kind);
  const keepIds = new Set(mine.slice(-keep).map((b) => b.id));
  db.blobs = db.blobs.filter((b) => b.project_id !== projectId || b.kind !== kind || keepIds.has(b.id));
  save();
}
export async function latestBlobs(projectId, kind, n = 2) {
  return init()
    .blobs.filter((b) => b.project_id === projectId && b.kind === kind)
    .slice(-n)
    .reverse()
    .map((b) => ({ at: b.at, data: JSON.parse(JSON.stringify(b.data)) }));
}

/* ------------------------------------------------------------------ the work queue (SEOPilot's three memory rules) */

/**
 * dismissed stays dismissed (a judgement about the finding); done REOPENS if the next sync still finds it; open resolves itself when its
 * finding is gone. Swept per SOURCE, so a producer only ever resolves its own rows.
 */
export function upsertActions({ orgId, projectId, source, drafts }) {
  const db = init();
  const seen = new Set(drafts.map((x) => x.id));
  for (const draft of drafts) {
    const ex = db.actions.find((a) => a.id === draft.id);
    if (!ex) {
      db.actions.push({ ...draft, source, org_id: orgId, status: "open", created_at: now(), updated_at: now(), resolved_at: null, reopened_at: null });
      continue;
    }
    Object.assign(ex, { title: draft.title, detail: draft.detail, priority: draft.priority, evidence: draft.evidence, updated_at: now() });
    if (ex.status === "done") Object.assign(ex, { status: "open", reopened_at: now(), resolved_at: null });
  }
  for (const a of db.actions) {
    if (a.project_id !== projectId || a.source !== source || a.status !== "open" || seen.has(a.id)) continue;
    Object.assign(a, { status: "resolved", resolved_at: now(), updated_at: now() });
  }
  save();
}
const PRIORITY = { high: 0, medium: 1, low: 2 };
export const listActions = (orgId, projectId = null) =>
  init()
    .actions.filter((a) => a.org_id === orgId && (!projectId || a.project_id === projectId))
    .sort((a, b) => (PRIORITY[a.priority] ?? 3) - (PRIORITY[b.priority] ?? 3) || String(b.updated_at).localeCompare(String(a.updated_at)));
export function setActionStatus(actionId, orgId, status) {
  if (!["open", "done", "dismissed"].includes(status)) throw new Error("Unknown status.");
  const a = init().actions.find((x) => x.id === actionId && x.org_id === orgId);
  if (!a) throw new Error("No such task.");
  Object.assign(a, { status, updated_at: now() });
  save();
  return a;
}

/* ------------------------------------------------------------------ alerts (events, not states — SEOPilot's rules) */

/**
 * A draft not seen before is raised. One that resolved and is seen again is a NEW incident: acknowledgement cleared, notification re-armed.
 * An open one this pass can speak for (its producer is in `covers`) and did not see is resolved. Only the data resolves an alert.
 */
export function raiseAlerts({ orgId, projectId, drafts = [], covers = [], producerOf = () => "other" }) {
  const db = init();
  const seen = new Set(drafts.map((x) => x.id));
  const speaksFor = new Set(covers);
  const newly = [];
  for (const draft of drafts) {
    const ex = db.alerts.find((a) => a.id === draft.id);
    if (!ex) {
      const row = { ...draft, org_id: orgId, status: "open", raised_at: now(), updated_at: now(), resolved_at: null, acknowledged_at: null, notified_at: null, occurrences: 1 };
      db.alerts.push(row);
      newly.push(row);
      continue;
    }
    if (ex.status === "resolved") {
      Object.assign(ex, { ...draft, status: "open", raised_at: now(), resolved_at: null, acknowledged_at: null, notified_at: null, occurrences: (ex.occurrences || 1) + 1, updated_at: now() });
      newly.push(ex);
    } else Object.assign(ex, { title: draft.title, detail: draft.detail, evidence: draft.evidence, severity: draft.severity, updated_at: now() });
  }
  for (const a of db.alerts) {
    if (a.project_id !== projectId || a.status !== "open" || seen.has(a.id) || !speaksFor.has(producerOf(a.type))) continue;
    Object.assign(a, { status: "resolved", resolved_at: now(), updated_at: now() });
  }
  save();
  return { newly };
}
export const listAlerts = (orgId) => init().alerts.filter((a) => a.org_id === orgId).sort((a, b) => String(b.raised_at).localeCompare(String(a.raised_at)));
export function acknowledgeAlert(alertId, orgId) {
  const a = init().alerts.find((x) => x.id === alertId && x.org_id === orgId);
  if (!a) throw new Error("No such alert.");
  a.acknowledged_at = now();
  save();
  return a;
}
export function markAlertNotified(alertId, { error = "" } = {}) {
  const a = init().alerts.find((x) => x.id === alertId);
  if (!a) return;
  if (error) a.notify_error = error;
  else a.notified_at = now();
  save();
}

/* ------------------------------------------------------------------ activity and AI usage */

export function logActivity(kind, title, detail, orgId) {
  const db = init();
  db.activity.push({ id: id("act"), kind, title, detail: String(detail || ""), org_id: orgId || "", at: now() });
  if (db.activity.length > 2000) db.activity = db.activity.slice(-2000);
  save();
}
export const listActivity = (orgId, n = 50) => init().activity.filter((a) => a.org_id === orgId).slice(-n).reverse();

export async function recordAiUsage({ orgId, projectId = "", kind, engine, model, usage, costUsd }) {
  const db = init();
  db.aiUsage.push({ org_id: orgId || "", project_id: projectId, kind, engine: engine || "", model: model || "", input_tokens: usage?.input_tokens ?? null, output_tokens: usage?.output_tokens ?? null, cost_usd: typeof costUsd === "number" ? costUsd : null, at: now() });
  if (db.aiUsage.length > 20000) db.aiUsage = db.aiUsage.slice(-20000);
  save();
}
export const aiRunsSince = (orgId, sinceMs) => init().aiUsage.filter((u) => u.org_id === orgId && Date.parse(u.at) >= sinceMs).length;

/* ------------------------------------------------------------------ install settings (platform admin) */

/** The Google OAuth client. Environment wins, so a deployment that sets it has said where it comes from. */
export function googleConfig() {
  const s = init().settings;
  const fromEnv = !!(process.env.AP_GOOGLE_CLIENT_ID && process.env.AP_GOOGLE_CLIENT_SECRET);
  return { clientId: process.env.AP_GOOGLE_CLIENT_ID || s.googleClientId || "", clientSecret: process.env.AP_GOOGLE_CLIENT_SECRET || unseal(s.googleClientSecret || "") || "", fromEnv };
}
export function setGoogleConfig({ clientId, clientSecret }) {
  const s = init().settings;
  if (clientId != null) s.googleClientId = String(clientId).trim();
  // Blank secret = keep the one you have: the screen cannot show it back, so it cannot send it back.
  if (clientSecret) s.googleClientSecret = seal(String(clientSecret).trim());
  save();
}

/** The Google Ads developer token (sealed) and API version. Environment wins. */
export function gadsConfig() {
  const s = init().settings;
  const fromEnv = !!process.env.AP_GADS_DEVELOPER_TOKEN;
  const developerToken = process.env.AP_GADS_DEVELOPER_TOKEN || unseal(s.gadsDeveloperToken || "") || "";
  return { developerToken, hasToken: !!developerToken, version: process.env.AP_GADS_API_VERSION || s.gadsApiVersion || "", fromEnv };
}
export function setGadsConfig({ developerToken, version }) {
  const s = init().settings;
  if (developerToken) s.gadsDeveloperToken = seal(String(developerToken).trim());
  if (version !== undefined) s.gadsApiVersion = /^v\d{2,3}$/.test(String(version).trim()) ? String(version).trim() : "";
  save();
}

export function setAlertEmails(orgId, emails) {
  const o = getOrg(orgId);
  if (!o) throw new Error("No such workspace.");
  o.alert_emails = emails;
  save();
}
