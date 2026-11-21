// server/test/ads-routes.test.mjs — AdsPilot's routes over real HTTP, against a fake Google Ads API and an in-memory store: sync files
// queue rows, alerts and proposals; nothing is written while changes are off; only an owner/admin can turn them on; apply and undo go
// through and are journalled; another workspace sees nothing; the model is never asked.
//
// The store here is a small fake with the same method names routes/ads.js calls, so this tests the ROUTES (gates, locks, state) without
// booting server.js. The real store's methods it stands in for are exercised by their own tests.
//
// Run: node server/test/ads-routes.test.mjs

import assert from "node:assert/strict";
import express from "express";
import { mountAds } from "../routes/ads.js";
import { fakeGads, CID } from "./fakegads.mjs";

let passed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
}

/* ------------------------------------------------------------------ a fake store */
function fakeDb() {
  const projects = [
    { id: "p1", org_id: "o1", name: "Acme Plumbing", domain: "acme.com" },
    { id: "p2", org_id: "o2", name: "Other", domain: "other.com" },
  ];
  const conns = new Map();
  const blobs = [];
  const actions = [];
  const alerts = [];
  const activity = [];
  let gadsCfg = { developerToken: "", version: "" };
  return {
    projects, actions, alerts, activity, conns,
    getProject: (id, orgId) => projects.find((p) => p.id === id && (orgId === undefined || p.org_id === orgId)) || null,
    listAllProjects: () => projects.slice(),
    getProjectConnection: (pid, kind) => conns.get(`${pid}|${kind}`) || null,
    setProjectConnection: (pid, kind, patch) => {
      const prev = conns.get(`${pid}|${kind}`) || { project_id: pid, kind, email: "", properties: [], config: null, list_error: "" };
      const next = { ...prev, ...(patch.email !== undefined ? { email: patch.email } : {}), ...(patch.properties ? { properties: patch.properties } : {}), ...(patch.config !== undefined ? { config: patch.config } : {}) };
      conns.set(`${pid}|${kind}`, next);
      return next;
    },
    saveBlob: async ({ projectId, kind, data, keep }) => {
      blobs.push({ projectId, kind, data: JSON.parse(JSON.stringify(data)), at: Date.now() + blobs.length });
      const mine = blobs.filter((b) => b.projectId === projectId && b.kind === kind);
      for (const old of mine.slice(0, Math.max(0, mine.length - keep))) blobs.splice(blobs.indexOf(old), 1);
    },
    latestBlobs: async (pid, kind, n) => blobs.filter((b) => b.projectId === pid && b.kind === kind).slice(-n).reverse().map((b) => ({ at: b.at, data: JSON.parse(JSON.stringify(b.data)) })),
    upsertActions: ({ source, drafts }) => {
      for (const d of drafts) if (!actions.find((a) => a.id === d.id)) actions.push({ ...d, source });
    },
    raiseAlerts: ({ drafts }) => {
      const newly = drafts.filter((d) => !alerts.find((a) => a.id === d.id));
      alerts.push(...newly);
      return { newly };
    },
    logActivity: (...a) => activity.push(a),
    recordAiUsage: async () => {},
    gadsConfig: () => ({ developerToken: gadsCfg.developerToken, hasToken: !!gadsCfg.developerToken, version: gadsCfg.version, fromEnv: false }),
    setGadsConfig: ({ developerToken, version }) => {
      if (developerToken) gadsCfg.developerToken = developerToken;
      if (version !== undefined) gadsCfg.version = version;
    },
  };
}

const db = fakeDb();
const fake = fakeGads();
let aiCalls = 0;
const ai = { ask: async () => { aiCalls++; return { text: '{"headlines":["Emergency Plumber Pune","Licensed Plumbers","Plumbing Repairs Pune","Save 50% Today"],"descriptions":["Licensed plumbers for leaks and repairs across Pune.","Call Acme for a plumber today."]}', engine: "fake", model: "fake" }; } };
const requireAdmin = (req) => { if (!["owner", "admin"].includes(req.auth.role)) throw new Error("Only the workspace owner can do that."); };
const requirePlatformAdmin = (req) => { if (!req.auth.platformAdmin) throw new Error("Not found."); };

const app = express();
app.use(express.json());
// Who is asking comes from a header in this test; the real server sets req.auth from the session.
app.use((req, _res, next) => {
  const who = req.headers["x-who"] || "owner";
  req.auth = { owner: { org: { id: "o1" }, role: "owner", user: { email: "owner@acme.test" }, platformAdmin: true }, member: { org: { id: "o1" }, role: "member", user: { email: "m@acme.test" } }, stranger: { org: { id: "o2" }, role: "owner", user: { email: "x@other.test" } } }[who];
  next();
});
const ok = (res, data = {}) => res.json({ ok: true, ...data });
const fail = (res, e) => res.status(400).json({ ok: false, error: e?.message || String(e) });
const ads = mountAds(app, { db, ok, fail, ai, accessTokenFor: async () => "access-token", requireAdmin, requirePlatformAdmin, requestImpl: fake.impl });
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/api`;
const call = async (path, { method = "GET", body, who = "owner" } = {}) => {
  const r = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", "x-who": who }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const mutateCount = () => fake.calls.filter((c) => c.url.endsWith(":mutate")).length;

try {
  await check("before anything is set up, the screen says what is missing and a sync says who fixes it", async () => {
    const r = await call("/projects/p1/ads");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.setup, { developerToken: false, connected: false, accountChosen: false, canAllowWrites: true });
    const s = await call("/projects/p1/ads/sync", { method: "POST" });
    assert.equal(s.status, 400);
    assert.match(s.body.error, /Connect Google Ads first/);
  });

  await check("the developer token is platform-admin only, never handed back, and the version is checked", async () => {
    assert.equal((await call("/admin/gads", { who: "member" })).status, 400);
    assert.equal((await call("/admin/gads", { method: "POST", body: { version: "22" } })).status, 400);
    const r = await call("/admin/gads", { method: "POST", body: { developerToken: "dev-token", version: "v22" } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.hasToken, true);
    assert.ok(!JSON.stringify(r.body).includes("dev-token"));
  });

  db.setProjectConnection("p1", "gads", { email: "ads@acme.test", properties: [{ property: CID, name: "Acme Plumbing" }], config: { property: CID } });

  await check("sync: findings, ads queue rows, ads alerts and open proposals; read-only calls only", async () => {
    const r = await call("/projects/p1/ads/sync", { method: "POST" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.sync.account.currency, "INR");
    assert.ok(r.body.findings.wastedTerms.length >= 2);
    assert.ok(db.actions.every((a) => a.source === "gads" && a.type.startsWith("ads:")));
    assert.ok(db.alerts.some((a) => a.type === "ads:spend-spike"));
    assert.ok(r.body.proposals.filter((p) => p.status === "open").length >= 3);
    assert.equal(r.body.connection.writesAllowed, false);
    assert.equal(mutateCount(), 0, "a sync never writes");
    assert.ok(fake.calls.every((c) => c.headers["developer-token"] === "dev-token"));
  });

  const view = (await call("/projects/p1/ads")).body;
  const neg = view.proposals.find((p) => p.kind === "add_negative");
  const budget = view.proposals.find((p) => p.kind === "set_budget");

  await check("while changes are off, approving a suggestion is refused and nothing reaches Google", async () => {
    const r = await call(`/projects/p1/ads/proposals/${neg.id}/apply`, { method: "POST", body: { confirm: true } });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /switched off/);
    assert.equal(mutateCount(), 0);
  });

  await check("only an owner/admin can allow changes, and allowing must be confirmed", async () => {
    assert.match((await call("/projects/p1/ads/writes", { method: "POST", body: { allow: true, confirm: true }, who: "member" })).body.error, /owner/);
    assert.match((await call("/projects/p1/ads/writes", { method: "POST", body: { allow: true } })).body.error, /Confirm/);
    const r = await call("/projects/p1/ads/writes", { method: "POST", body: { allow: true, confirm: true } });
    assert.equal(r.body.connection.writesAllowed, true);
    assert.equal(r.body.connection.writesAllowedBy, "owner@acme.test");
  });

  await check("apply needs an explicit confirm; then it is written, verified, journalled, and the suggestion closes", async () => {
    assert.match((await call(`/projects/p1/ads/proposals/${neg.id}/apply`, { method: "POST", body: {} })).body.error, /Confirm/);
    const r = await call(`/projects/p1/ads/proposals/${neg.id}/apply`, { method: "POST", body: { confirm: true } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.entry.verified, true);
    assert.equal(r.body.state.journal[0].id, r.body.entry.id);
    assert.equal(r.body.state.proposals.find((p) => p.id === neg.id).status, "applied");
    assert.equal(fake.acct.state.negatives.length, 1);
    assert.match((await call(`/projects/p1/ads/proposals/${neg.id}/apply`, { method: "POST", body: { confirm: true } })).body.error, /already applied/);
  });

  await check("a budget suggestion may be lowered by the person, never raised past what was suggested", async () => {
    const r = await call(`/projects/p1/ads/proposals/${budget.id}/apply`, { method: "POST", body: { confirm: true, to: 99999 } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(fake.acct.state.budgets[budget.budgetResource].amountMicros, String(budget.to * 1_000_000));
  });

  await check("undo: confirmed, journalled, and the suggestion reads undone", async () => {
    const j = (await call("/projects/p1/ads")).body.journal.find((x) => x.kind === "add_negative");
    assert.match((await call(`/projects/p1/ads/journal/${j.id}/undo`, { method: "POST", body: {} })).body.error, /Confirm/);
    const r = await call(`/projects/p1/ads/journal/${j.id}/undo`, { method: "POST", body: { confirm: true } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.result.verified, true);
    assert.ok(r.body.state.journal.find((x) => x.id === j.id).undone_at);
    assert.equal(fake.acct.state.negatives.length, 0);
  });

  await check("a re-sync keeps applied/undone suggestions as they are and does not reopen them", async () => {
    const r = await call("/projects/p1/ads/sync", { method: "POST" });
    const same = r.body.proposals.filter((p) => p.id === neg.id);
    assert.equal(same.length, 1);
    assert.equal(same[0].status, "undone");
  });

  await check("ad copy: drafted from the sync, invented claims dropped, and creating it is a paused ad behind the same switch", async () => {
    const adGroupId = (await call("/projects/p1/ads")).body.findings.weakAds[0].adGroupId;
    const d = await call("/projects/p1/ads/copy", { method: "POST", body: { adGroupId } });
    assert.equal(d.status, 200, JSON.stringify(d.body));
    assert.ok(d.body.draft.dropped.some((x) => x.text === "Save 50% Today"));
    const c = await call("/projects/p1/ads/copy/create", { method: "POST", body: { adGroupId, headlines: d.body.draft.headlines, descriptions: d.body.draft.descriptions, finalUrl: d.body.draft.finalUrl, confirm: true } });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.equal(c.body.entry.after.status, "PAUSED");
  });

  await check("questions are answered from the sync and an invented figure is named", async () => {
    ai.ask = async () => ({ text: "Cost per conversion was 500. You could save 7300.", engine: "fake", model: "fake" });
    const r = await call("/projects/p1/ads/ask", { method: "POST", body: { question: "how are we doing?" } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.answer.unsupported, ["7300"]);
    assert.equal((await call("/projects/p1/ads")).body.thread.length, 2);
  });

  await check("switching changes off stops writes again", async () => {
    await call("/projects/p1/ads/writes", { method: "POST", body: { allow: false } });
    const open = (await call("/projects/p1/ads")).body.proposals.find((p) => p.status === "open");
    const before = mutateCount();
    assert.match((await call(`/projects/p1/ads/proposals/${open.id}/apply`, { method: "POST", body: { confirm: true } })).body.error, /switched off/);
    assert.equal(mutateCount(), before);
  });

  await check("another workspace can neither read nor act on this project", async () => {
    for (const [path, method] of [["/projects/p1/ads", "GET"], ["/projects/p1/ads/sync", "POST"], ["/projects/p1/ads/writes", "POST"], ["/projects/p1/ads/ask", "POST"]]) {
      const r = await call(path, { method, body: method === "POST" ? { allow: true, confirm: true, question: "x" } : undefined, who: "stranger" });
      assert.equal(r.status, 400, path);
      assert.match(r.body.error, /No such project/);
    }
  });

  await check("the timer syncs an account not read for 20 hours and leaves a fresh one alone", async () => {
    const before = fake.calls.length;
    await ads.tick(Date.now());
    assert.equal(fake.calls.length, before, "just synced: left alone");
    await ads.tick(Date.now() + 21 * 3_600_000);
    assert.ok(fake.calls.length > before);
  });

  assert.ok(aiCalls >= 1);
} finally {
  server.close();
}

console.log(`ads-routes: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
