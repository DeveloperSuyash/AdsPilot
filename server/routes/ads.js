// routes/ads.js — AdsPilot: one Google Ads account per project, read on a schedule, turned into findings, queue rows, alerts and PROPOSED
// changes that a person approves one at a time and can undo.
//
// What lives where:
//   lib/gads.js        the API (REST, injectable, version is a setting)
//   lib/adssync.js     what is read, and its shape
//   lib/adsanalyze.js  findings and queue rows (pure)
//   lib/adsalerts.js   incidents (pure)
//   lib/adschange.js   proposals (pure) and the ONLY code that writes, with the before-read, validateOnly, read-back and undo
//   lib/adscopy.js     ad copy, held to Google's limits by code
//   lib/adsanalyst.js  the fact sheet for questions; analyst.js's reconcile checks the answer
//
// Storage, all outside the document (it grows): blob "ads-sync" (the last 4 syncs) and blob "ads-state" (settings, proposals, journal, the
// question thread, the last ad-copy drafts). A per-project lock keeps two requests from writing ads-state over each other.
//
// Writes are off until a workspace owner/admin turns them on for the account (`config.writesAllowed`). Re-pointing the project at another
// account goes through the generic connections/config route, which replaces `config` and so switches writes off again — on purpose: a
// permission given for one account must not follow the project to another.

import * as gads from "../lib/gads.js";
import * as adssync from "../lib/adssync.js";
import * as adsanalyze from "../lib/adsanalyze.js";
import * as adsalerts from "../lib/adsalerts.js";
import * as adschange from "../lib/adschange.js";
import * as adscopy from "../lib/adscopy.js";
import * as adsanalyst from "../lib/adsanalyst.js";
import { reconcile } from "../lib/reconcile.js";

const locks = new Map();
const THREAD_MAX = 40;
const JOURNAL_MAX = 200;
const SYNC_EVERY_MS = 20 * 3_600_000;

export function mountAds(app, { db, ok, fail, ai, costOfAnswer = () => null, accessTokenFor, requireAdmin, requirePlatformAdmin, deliverAlerts = async () => {}, devpilot = () => null, requestImpl = fetch }) {
  const proj = (req) => {
    const p = db.getProject(req.params.id, req.auth.org.id);
    if (!p) throw new Error("No such project.");
    return p;
  };
  const conn = (pid) => db.getProjectConnection(pid, "gads");

  const readState = async (pid) => {
    const d = (await db.latestBlobs(pid, "ads-state", 1))[0]?.data || {};
    return {
      settings: { maxDailyBudget: d.settings?.maxDailyBudget ?? null, businessFacts: d.settings?.businessFacts || "", brandWords: d.settings?.brandWords || "" },
      proposals: d.proposals || [],
      journal: d.journal || [],
      thread: d.thread || [],
      drafts: d.drafts || {},
      lastSync: d.lastSync || null,
    };
  };
  function mutate(pid, fn) {
    const run = (locks.get(pid) || Promise.resolve()).then(async () => {
      const st = await readState(pid);
      const out = await fn(st);
      st.journal = st.journal.slice(0, JOURNAL_MAX);
      st.thread = st.thread.slice(-THREAD_MAX);
      await db.saveBlob({ projectId: pid, kind: "ads-state", keep: 1, data: { ...st, updated_at: new Date().toISOString() } });
      return out;
    });
    locks.set(pid, run.catch(() => {}));
    return run;
  }
  const latestSync = async (pid) => (await db.latestBlobs(pid, "ads-sync", 1))[0]?.data || null;

  /** A client for this project's chosen account, or an error that names what is missing and who can fix it. */
  async function clientFor(p) {
    const c = conn(p.id);
    if (!c) throw new Error("Connect Google Ads first, on this account's page.");
    if (!c.config?.property) throw new Error("Pick which Google Ads account this client is for, on this account's page.");
    const cfg = db.gadsConfig();
    if (!cfg.hasToken) throw new Error("Google Ads is not switched on for this install yet: the platform admin adds the developer token under Admin → Google Ads.");
    const { loginCustomerId, customerId } = gads.parseProperty(c.config.property);
    const accessToken = await accessTokenFor(p.id, "gads");
    return { client: gads.client({ accessToken, developerToken: cfg.developerToken, loginCustomerId, version: cfg.version || undefined }, requestImpl), customerId, connection: c };
  }

  const brandWordsFor = (p, st) => [p.name || "", String(p.domain || "").split(".")[0], st.settings.brandWords || ""].filter(Boolean);
  const limitsOf = (st) => ({ maxDailyBudget: st.settings.maxDailyBudget === null ? null : Number(st.settings.maxDailyBudget) });

  /**
   * Read the account, store the sync, and file what it found. Used by the button and the timer alike, so the two can never drift.
   * Proposals keep their history: one that was applied or dismissed stays so; an OPEN one that the new sync no longer supports is dropped,
   * because approving a change the current data no longer argues for is approving a guess.
   */
  async function runSync(p) {
    const { client, customerId } = await clientFor(p);
    const sync = await adssync.fetchAds(client, customerId);
    await db.saveBlob({ projectId: p.id, kind: "ads-sync", keep: 4, data: sync });
    return mutate(p.id, async (st) => {
      const f = adsanalyze.findings(sync, { brandWords: brandWordsFor(p, st) });
      db.upsertActions({ orgId: p.org_id, projectId: p.id, source: "gads", drafts: adsanalyze.buildActions(p.id, f) });
      const drafts = adsalerts.evaluate({ project: p, sync, findings: f });
      const raised = db.raiseAlerts({ orgId: p.org_id, projectId: p.id, drafts, covers: adsalerts.ADS_PRODUCERS, producerOf: adsalerts.producerOf });
      if (raised.newly?.length) await deliverAlerts(p.org_id, raised.newly);

      const fresh = adschange.proposalsFrom(p.id, f, limitsOf(st));
      const byId = new Map(st.proposals.map((x) => [x.id, x]));
      const next = [];
      for (const np of fresh) {
        const old = byId.get(np.id);
        if (old && old.status !== "open") next.push(old);
        else next.push({ ...np, status: "open", created_at: old?.created_at || new Date().toISOString(), updated_at: new Date().toISOString() });
        byId.delete(np.id);
      }
      for (const old of byId.values()) if (old.status !== "open") next.push(old);
      st.proposals = next.slice(-300);
      st.lastSync = { at: sync.synced_at, ok: true, error: "" };
      db.logActivity("ads", `${p.name} — Google Ads synced`, `${f.wastedTerms.length} wasted search terms, ${fresh.length} suggested changes`, p.org_id);
      return { sync, findings: f };
    });
  }

  async function recordFailure(p, e) {
    await mutate(p.id, (st) => {
      st.lastSync = { at: new Date().toISOString(), ok: false, error: e.message };
    });
  }

  async function view(p, role) {
    const c = conn(p.id);
    const st = await readState(p.id);
    const sync = await latestSync(p.id);
    const cfg = db.gadsConfig();
    const f = sync ? adsanalyze.findings(sync, { brandWords: brandWordsFor(p, st) }) : null;
    const account = c?.config?.property ? (c.properties || []).find((x) => x.property === c.config.property) : null;
    return {
      setup: { developerToken: cfg.hasToken, connected: !!c, accountChosen: !!c?.config?.property, canAllowWrites: role === "owner" || role === "admin" },
      connection: c ? { email: c.email, account: c.config?.property || "", accountName: account?.name || "", writesAllowed: c.config?.writesAllowed === true, writesAllowedBy: c.config?.writesAllowedBy || "", accounts: c.properties || [], listError: c.list_error || "" } : null,
      lastSync: st.lastSync,
      sync: sync
        ? { at: sync.synced_at, range: sync.range, account: sync.account, metrics: adsanalyze.metrics(sync), capped: sync.capped, campaigns: sync.campaigns.slice(0, 50) }
        : null,
      findings: f,
      proposals: st.proposals.filter((x) => x.status === "open").concat(st.proposals.filter((x) => x.status !== "open").slice(-30)),
      journal: st.journal.slice(0, 50),
      settings: st.settings,
      thread: st.thread,
      drafts: st.drafts,
      limits: { budgetMaxStepPercent: Math.round(adschange.BUDGET_MAX_STEP * 100), rsa: { headline: adscopy.RSA.HEADLINE_MAX, description: adscopy.RSA.DESCRIPTION_MAX, path: adscopy.RSA.PATH_MAX } },
      devpilot: devpilot(p),
    };
  }

  /* ------------------------------------------------------------------ routes */

  app.get("/api/projects/:id/ads", async (req, res) => {
    try {
      ok(res, await view(proj(req), req.auth.role));
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/api/projects/:id/ads/sync", async (req, res) => {
    const p = (() => {
      try {
        return proj(req);
      } catch (e) {
        fail(res, e);
        return null;
      }
    })();
    if (!p) return;
    try {
      await runSync(p);
      ok(res, await view(p, req.auth.role));
    } catch (e) {
      await recordFailure(p, e).catch(() => {});
      fail(res, e);
    }
  });

  app.post("/api/projects/:id/ads/settings", async (req, res) => {
    try {
      const p = proj(req);
      const b = req.body || {};
      await mutate(p.id, (st) => {
        if (b.maxDailyBudget !== undefined) {
          const v = b.maxDailyBudget === null || b.maxDailyBudget === "" ? null : Number(b.maxDailyBudget);
          if (v !== null && !(v > 0)) throw new Error("The daily budget ceiling must be a positive number, or empty for none.");
          st.settings.maxDailyBudget = v;
        }
        if (b.businessFacts !== undefined) st.settings.businessFacts = String(b.businessFacts).slice(0, 2000);
        if (b.brandWords !== undefined) st.settings.brandWords = String(b.brandWords).slice(0, 300);
      });
      ok(res, await view(p, req.auth.role));
    } catch (e) {
      fail(res, e);
    }
  });

  /** Turn writes on or off for this account. Owner/admin only, and turning ON must be confirmed in the request itself. */
  app.post("/api/projects/:id/ads/writes", async (req, res) => {
    try {
      requireAdmin(req);
      const p = proj(req);
      const c = conn(p.id);
      if (!c?.config?.property) throw new Error("Pick the Google Ads account first.");
      const allow = req.body?.allow === true;
      if (allow && req.body?.confirm !== true) throw new Error("Confirm that AdsPilot may make the changes you approve on this account.");
      db.setProjectConnection(p.id, "gads", { config: { ...c.config, writesAllowed: allow, writesAllowedBy: allow ? req.auth.user?.email || "" : "", writesAllowedAt: allow ? new Date().toISOString() : null } });
      db.logActivity("ads", `${p.name} — Google Ads changes ${allow ? "allowed" : "switched off"}`, c.config.property, p.org_id);
      ok(res, await view(p, req.auth.role));
    } catch (e) {
      fail(res, e);
    }
  });

  async function applyAndRecord(p, req, proposal, proposalId = "") {
    const { client, customerId, connection } = await clientFor(p);
    return mutate(p.id, async (st) => {
      const entry = await adschange.apply({ client, customerId, connection, proposal, limits: limitsOf(st), by: req.auth.user?.email || "" });
      st.journal.unshift(entry);
      if (proposalId) {
        const pr = st.proposals.find((x) => x.id === proposalId);
        if (pr) Object.assign(pr, { status: "applied", journal_id: entry.id, updated_at: new Date().toISOString() });
      }
      db.logActivity("ads", `${p.name} — ${entry.summary}`, entry.verified ? "verified" : "NOT verified — check in Google Ads", p.org_id);
      return entry;
    });
  }

  app.post("/api/projects/:id/ads/proposals/:pid/apply", async (req, res) => {
    try {
      const p = proj(req);
      if (req.body?.confirm !== true) throw new Error("Confirm the change first.");
      const st = await readState(p.id);
      const pr = st.proposals.find((x) => x.id === req.params.pid);
      if (!pr) throw new Error("That suggestion is gone — sync again for current ones.");
      if (pr.status !== "open") throw new Error(`That suggestion was already ${pr.status}.`);
      // The person may lower a suggested budget (never raise it past the suggestion); the limits in adschange still apply on top.
      const proposal = pr.kind === "set_budget" && req.body?.to !== undefined ? { ...pr, to: Math.min(Number(req.body.to), pr.to) } : pr;
      const entry = await applyAndRecord(p, req, proposal, pr.id);
      ok(res, { entry, state: await view(p, req.auth.role) });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/api/projects/:id/ads/proposals/:pid/dismiss", async (req, res) => {
    try {
      const p = proj(req);
      await mutate(p.id, (st) => {
        const pr = st.proposals.find((x) => x.id === req.params.pid);
        if (!pr) throw new Error("No such suggestion.");
        if (pr.status === "open") Object.assign(pr, { status: "dismissed", updated_at: new Date().toISOString() });
      });
      ok(res, await view(p, req.auth.role));
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/api/projects/:id/ads/journal/:jid/undo", async (req, res) => {
    try {
      const p = proj(req);
      if (req.body?.confirm !== true) throw new Error("Confirm the undo first.");
      const { client, customerId, connection } = await clientFor(p);
      const result = await mutate(p.id, async (st) => {
        const entry = st.journal.find((j) => j.id === req.params.jid);
        if (!entry) throw new Error("No such change.");
        const r = await adschange.undo({ client, customerId, connection, entry, limits: limitsOf(st) });
        Object.assign(entry, { undone_at: new Date().toISOString(), undone_by: req.auth.user?.email || "", undo_verified: r.verified });
        const pr = st.proposals.find((x) => x.id === entry.proposal_id);
        if (pr) Object.assign(pr, { status: "undone", updated_at: new Date().toISOString() });
        db.logActivity("ads", `${p.name} — undone: ${entry.summary}`, r.verified ? "verified" : "NOT verified — check in Google Ads", p.org_id);
        return r;
      });
      ok(res, { result, state: await view(p, req.auth.role) });
    } catch (e) {
      fail(res, e);
    }
  });

  /** Draft new ad copy for an ad group in the last sync. One AI run; nothing is written to Google Ads. */
  app.post("/api/projects/:id/ads/copy", async (req, res) => {
    try {
      const p = proj(req);
      const sync = await latestSync(p.id);
      if (!sync) throw new Error("Sync Google Ads first.");
      const adGroupId = String(req.body?.adGroupId || "");
      const ad = sync.ads.find((a) => a.adGroupId === adGroupId && a.headlines.length) || sync.ads.find((a) => a.adGroupId === adGroupId);
      if (!ad) throw new Error("That ad group is not in the last sync.");
      const st = await readState(p.id);
      const kw = sync.keywords.filter((k) => k.adGroupId === adGroupId).sort((a, b) => b.clicks - a.clicks)[0];
      const terms = sync.searchTerms.filter((t) => t.adGroupId === adGroupId && t.conversions > 0).map((t) => t.term);
      const prompt = adscopy.buildPrompt({ businessFacts: st.settings.businessFacts, keyword: kw?.text || "", adGroup: ad.adGroup, searchTerms: terms, currentAd: ad });
      const out = await ai.ask({ system: adscopy.SYSTEM_PROMPT, prompt });
      void db.recordAiUsage({ orgId: req.auth.org.id, projectId: p.id, kind: "ads-copy", engine: out.engine, model: out.model, tried: out.tried, usage: out.usage, costUsd: costOfAnswer(out) });
      const parsed = adscopy.parseCopy(out.text, { businessFacts: st.settings.businessFacts });
      const draft = { ...parsed, adGroupId, adGroup: ad.adGroup, campaign: ad.campaign, finalUrl: ad.finalUrls[0] || "", at: new Date().toISOString() };
      await mutate(p.id, (s) => {
        s.drafts = { ...s.drafts, [adGroupId]: draft };
      });
      ok(res, { draft });
    } catch (e) {
      fail(res, e);
    }
  });

  /** Create the chosen lines as a new PAUSED ad. A write, so it is behind the same switch as every other change. */
  app.post("/api/projects/:id/ads/copy/create", async (req, res) => {
    try {
      const p = proj(req);
      if (req.body?.confirm !== true) throw new Error("Confirm first.");
      const b = req.body || {};
      const entry = await applyAndRecord(p, req, { kind: "create_paused_ad", adGroupId: b.adGroupId, headlines: b.headlines, descriptions: b.descriptions, finalUrl: b.finalUrl, path1: b.path1, path2: b.path2 });
      ok(res, { entry, state: await view(p, req.auth.role) });
    } catch (e) {
      fail(res, e);
    }
  });

  /** A question about the account, answered from the last sync and checked figure by figure. */
  app.post("/api/projects/:id/ads/ask", async (req, res) => {
    try {
      const p = proj(req);
      const q = String(req.body?.question || "").trim();
      if (!q) throw new Error("Ask a question first.");
      const sync = await latestSync(p.id);
      if (!sync) throw new Error("Sync Google Ads first: the answers come from the synced data.");
      const st = await readState(p.id);
      const f = adsanalyze.findings(sync, { brandWords: brandWordsFor(p, st) });
      const facts = adsanalyst.buildFacts({ sync, findings: f, proposals: st.proposals.filter((x) => x.status === "open"), journal: st.journal });
      // Earlier turns go in as context only, and only answers that were fully verified against the SAME sync (analyst.js's rule).
      const history = st.thread
        .slice(-6)
        .map((m) => (m.role === "user" ? `Earlier question: ${m.content.slice(0, 300)}` : m.sync_at === sync.synced_at && !m.unsupported?.length ? `Earlier answer: ${m.content.slice(0, 600)}` : "Earlier answer: (not reused)"))
        .join("\n");
      const out = await ai.ask({ system: adsanalyst.SYSTEM_PROMPT, prompt: adsanalyst.buildPrompt(q, facts, history ? `CONTEXT (not data):\n${history}` : "") });
      void db.recordAiUsage({ orgId: req.auth.org.id, projectId: p.id, kind: "ads-ask", engine: out.engine, model: out.model, tried: out.tried, usage: out.usage, costUsd: costOfAnswer(out) });
      const check = reconcile(out.text, facts);
      const answer = { role: "assistant", content: out.text, unsupported: check.unsupported, sync_at: sync.synced_at, at: new Date().toISOString() };
      await mutate(p.id, (s) => {
        s.thread.push({ role: "user", content: q, at: new Date().toISOString() }, answer);
      });
      ok(res, { answer });
    } catch (e) {
      fail(res, e);
    }
  });

  /* ------------------------------------------------------------------ platform admin: the developer token */

  app.get("/api/admin/gads", (req, res) => {
    try {
      requirePlatformAdmin(req);
      const c = db.gadsConfig();
      ok(res, { hasToken: c.hasToken, fromEnv: c.fromEnv, version: c.version || gads.DEFAULT_VERSION, defaultVersion: gads.DEFAULT_VERSION });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/api/admin/gads", (req, res) => {
    try {
      requirePlatformAdmin(req);
      if (db.gadsConfig().fromEnv) throw new Error("The Google Ads developer token is set from the environment (AP_GADS_DEVELOPER_TOKEN). Change it there.");
      const token = String(req.body?.developerToken || "").trim();
      const version = req.body?.version === undefined ? undefined : String(req.body.version).trim();
      if (version && !/^v\d{2,3}$/.test(version)) throw new Error('The API version looks like "v22".');
      db.setGadsConfig({ developerToken: token, version });
      db.logActivity("admin", "Updated the Google Ads settings", token ? "developer token replaced" : "", req.auth.org.id);
      const c = db.gadsConfig();
      ok(res, { hasToken: c.hasToken, fromEnv: c.fromEnv, version: c.version || gads.DEFAULT_VERSION, defaultVersion: gads.DEFAULT_VERSION });
    } catch (e) {
      fail(res, e);
    }
  });

  /* ------------------------------------------------------------------ the timer */

  let running = false;
  async function tick(now = Date.now()) {
    if (running) return;
    running = true;
    try {
      if (!db.gadsConfig().hasToken) return;
      for (const p of db.listAllProjects?.() || []) {
        const c = conn(p.id);
        if (!c?.config?.property) continue;
        const st = await readState(p.id);
        const last = st.lastSync?.at ? Date.parse(st.lastSync.at) : 0;
        // A failed sync waits the same 20 hours: an account that cannot be read today will not be readable in ten minutes, and hammering
        // it buries the one failure worth reading.
        if (now - last < SYNC_EVERY_MS) continue;
        try {
          await runSync(p);
        } catch (e) {
          await recordFailure(p, e).catch(() => {});
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    } catch (e) {
      console.error("  ads tick failed:", e.message);
    } finally {
      running = false;
    }
  }

  return { tick, runSync };
}
