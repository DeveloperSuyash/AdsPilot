// server/test/ads.test.mjs — AdsPilot's rules, module by module: the API client, the sync shape, findings, alerts, ad copy limits, and every
// guard on a write (the switch, the before-read, validateOnly first, the read-back, undo refusing a moved entity). No network, no model.
//
// Run: node server/test/ads.test.mjs

import assert from "node:assert/strict";
import * as gads from "../lib/gads.js";
import * as adssync from "../lib/adssync.js";
import * as adsanalyze from "../lib/adsanalyze.js";
import * as adsalerts from "../lib/adsalerts.js";
import * as adscopy from "../lib/adscopy.js";
import * as adschange from "../lib/adschange.js";
import * as adsanalyst from "../lib/adsanalyst.js";
const sharedProducerOf = adsalerts.producerOf;
import { reconcile } from "../lib/reconcile.js";
import { fakeGads, account, CID, MGR } from "./fakegads.mjs";

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

const NOW = new Date("2026-11-20T10:00:00Z");
const TOKEN = { accessToken: "at", developerToken: "dev-token" };
const writable = { config: { property: CID, writesAllowed: true } };

async function syncOf(acct = account()) {
  const f = fakeGads(acct);
  const c = gads.client(TOKEN, f.impl);
  return { sync: await adssync.fetchAds(c, CID, { now: NOW }), fake: f };
}

/* ------------------------------------------------------------------ gads.js */

await check("customer ids: dashes and resource names are cleaned; anything not ten digits is refused", () => {
  assert.equal(gads.cleanCid("123-456-7890"), "1234567890");
  assert.equal(gads.cleanCid("customers/1234567890"), "1234567890");
  assert.throws(() => gads.cleanCid("12345"), /ten digits/);
  assert.throws(() => gads.cleanCid("1234567890' OR 1=1"), /ten digits/);
  assert.equal(gads.prettyCid("1234567890"), "123-456-7890");
  assert.deepEqual(gads.parseProperty(`${MGR}:${CID}`), { loginCustomerId: MGR, customerId: CID });
  assert.deepEqual(gads.parseProperty(CID), { loginCustomerId: "", customerId: CID });
});

await check("money: micros become currency with two decimals, and a missing figure stays null rather than becoming 0", () => {
  assert.equal(gads.fromMicros("1234560000"), 1234.56);
  assert.equal(gads.fromMicros(null), null);
  assert.equal(gads.fromMicros(""), null);
  assert.equal(gads.toMicros(12.5), 12_500_000);
});

await check("every call carries the developer token; the manager's id is sent only when there is a manager", async () => {
  const f = fakeGads();
  await gads.client(TOKEN, f.impl).search(CID, "SELECT customer.id FROM customer LIMIT 1");
  assert.equal(f.calls[0].headers["developer-token"], "dev-token");
  assert.equal(f.calls[0].headers.authorization, "Bearer at");
  assert.equal(f.calls[0].headers["login-customer-id"], undefined);
  await gads.client({ ...TOKEN, loginCustomerId: MGR }, f.impl).search(CID, "SELECT customer.id FROM customer LIMIT 1");
  assert.equal(f.calls[1].headers["login-customer-id"], MGR);
  assert.throws(() => gads.client({ accessToken: "x" }, f.impl), /developer token/);
});

await check("search follows nextPageToken to the end, and stops at maxRows", async () => {
  let n = 0;
  const impl = async (_u, init) => {
    n++;
    const b = JSON.parse(init.body);
    const page = b.pageToken ? Number(b.pageToken) : 0;
    return { ok: true, status: 200, text: async () => JSON.stringify({ results: [{ i: page }, { i: page + 0.5 }], nextPageToken: page < 2 ? String(page + 1) : "" }) };
  };
  const rows = await gads.client(TOKEN, impl).search(CID, "q");
  assert.equal(rows.length, 6);
  assert.equal(n, 3);
  n = 0;
  const capped = await gads.client(TOKEN, impl).search(CID, "q", { maxRows: 3 });
  assert.equal(capped.length, 3);
  assert.equal(n, 2);
});

await check("errors: the GoogleAdsFailure detail is read, and a test-only developer token is said in words", async () => {
  const body = { error: { code: 403, message: "The caller does not have permission", details: [{ "@type": "type.googleapis.com/google.ads.googleads.v22.errors.GoogleAdsFailure", errors: [{ errorCode: { authorizationError: "DEVELOPER_TOKEN_NOT_APPROVED" }, message: "The developer token is only approved for use with test accounts." }] }] } };
  const f = fakeGads(account(), { failWith: { status: 403, body } });
  await assert.rejects(gads.client(TOKEN, f.impl).search(CID, "q"), /only approved for test accounts|Basic access/);
  assert.match(gads.explainError(401, {}), /expired or been revoked/);
  assert.match(gads.explainError(400, { error: { message: "weird" } }), /Google Ads: weird/);
});

await check("account list: client accounts under a manager are listed as mgr:cid, and the manager itself is not syncable", async () => {
  const f = fakeGads(account(), { accessible: [MGR], clients: [{ customerClient: { clientCustomer: `customers/${CID}`, descriptiveName: "Acme Plumbing", manager: false, level: 1, currencyCode: "INR", status: "ENABLED" } }, { customerClient: { clientCustomer: `customers/${MGR}`, manager: true, level: 0 } }] });
  const list = await gads.listAccounts(TOKEN, f.impl);
  assert.deepEqual(list.map((x) => x.property), [`${MGR}:${CID}`]);
  assert.match(list[0].name, /Acme Plumbing — via Agency MCC/);
});

/* ------------------------------------------------------------------ adssync.js */

await check("windows: 28 days ending yesterday, and the 28 before, back to back", () => {
  const w = adssync.windows(28, NOW);
  assert.deepEqual(w.current, { start: "2026-10-23", end: "2026-11-19" });
  assert.deepEqual(w.previous, { start: "2026-09-25", end: "2026-10-22" });
});

await check("every query is bounded (ORDER BY cost and a LIMIT) and filtered to its window", () => {
  const q = adssync.queries(adssync.windows(28, NOW));
  for (const k of ["campaigns", "searchTerms", "keywords", "ads"]) {
    assert.match(q[k], /ORDER BY metrics\.cost_micros DESC LIMIT \d+/, k);
    assert.match(q[k], /segments\.date BETWEEN '2026-10-23' AND '2026-11-19'/, k);
  }
  assert.match(q.accountPrev, /'2026-09-25' AND '2026-10-22'/);
});

await check("the sync shape: money in currency, impression share in percent, a share Google did not send stays null", async () => {
  const { sync } = await syncOf();
  assert.equal(sync.account.currency, "INR");
  assert.equal(sync.totals.cost, 20000);
  assert.equal(sync.previous.cost, 10000);
  const search = sync.campaigns.find((c) => c.id === "111");
  assert.equal(search.budget, 1000);
  assert.equal(search.lostToBudget, 25);
  assert.equal(sync.campaigns.find((c) => c.id === "222").lostToBudget, null, "display has no search share: not reported, not 0");
  assert.equal(sync.ads[0].headlines.length, 2);
});

await check("a query that fails fails the whole sync — never a partial sync that would claim no waste", async () => {
  const f = fakeGads();
  const broken = async (u, init) => (JSON.parse(init.body || "{}").query?.includes("search_term_view") ? { ok: false, status: 500, text: async () => "{}" } : f.impl(u, init));
  await assert.rejects(adssync.fetchAds(gads.client(TOKEN, broken), CID, { now: NOW }));
});

/* ------------------------------------------------------------------ adsanalyze.js */

await check("wasted terms: judged against the account's own cost per conversion, 5+ clicks, never a brand term", async () => {
  const { sync } = await syncOf();
  const f = adsanalyze.findings(sync, { brandWords: ["Acme Plumbing", "acme"] });
  assert.equal(f.kpis.cpa, 500);
  assert.deepEqual(f.wastedTerms.map((t) => t.term), ["plumber jobs", "plumber salary"], "under one conversion's worth, or a brand term, is not called waste");
  assert.equal(f.wastedTerms[0].timesCpa, 3);
  assert.equal(f.tracking, null);
});

await check("no conversions anywhere: the tracking finding, and NOTHING judged as wasted", async () => {
  const a = account();
  a.totals.conversions = 0;
  a.previous.conversions = 0;
  const { sync } = await syncOf(a);
  const f = adsanalyze.findings(sync);
  assert.equal(f.tracking.kind, "none");
  assert.deepEqual(f.wastedTerms, []);
  assert.deepEqual(f.negativeWords, []);
  assert.match(f.notes.join(" "), /not judged/);
});

await check("conversions that stopped after a period with some is its own, louder finding", async () => {
  const a = account();
  a.totals.conversions = 0;
  const { sync } = await syncOf(a);
  assert.equal(adsanalyze.findings(sync).tracking.kind, "stopped");
});

await check("negative words: shared by 3+ unconverting terms AND absent from every term that converted", () => {
  const term = (t, cost, clicks, conv = 0) => ({ term: t, status: "NONE", campaignId: "1", campaign: "C", adGroupId: "2", adGroup: "G", cost, clicks, impressions: 100, conversions: conv, value: 0 });
  const sync = {
    account: { currency: "INR" },
    totals: { cost: 1000, clicks: 100, impressions: 1000, conversions: 10, value: 0 },
    hasPrevious: false,
    campaigns: [],
    keywords: [],
    ads: [],
    searchTerms: [term("free plumbing course", 40, 3), term("free plumber course online", 40, 3), term("plumber course fees", 40, 3), term("free drain fix", 10, 1), term("drain fix free quote", 200, 20, 5)],
  };
  const f = adsanalyze.findings(sync);
  const words = f.negativeWords.map((w) => w.word);
  assert.ok(words.includes("course"), "course: three unconverting terms, never in a converting one");
  assert.ok(!words.includes("free"), "free appears in a term that converted, so it is not a negative");
});

await check("budget-limited: only enabled, losing 10%+ to budget, converting, and no worse than the account", async () => {
  const { sync } = await syncOf();
  const f = adsanalyze.findings(sync);
  assert.deepEqual(f.budgetLimited.map((c) => c.campaignId), ["111"]);
  assert.equal(f.budgetLimited[0].budget, 1000);
  const worse = { ...sync, campaigns: sync.campaigns.map((c) => (c.id === "111" ? { ...c, conversions: 3, cost: 9000 } : c)) };
  assert.deepEqual(adsanalyze.findings(worse).budgetLimited, [], "a campaign converting at 3000 against an account at 500 does not get more money");
});

await check("disapproved, low quality, poor ads and landing pages come out ranked, each with its evidence", async () => {
  const { sync } = await syncOf();
  const f = adsanalyze.findings(sync);
  assert.deepEqual(f.disapproved.map((a) => a.adId), ["902"]);
  assert.deepEqual(f.lowQuality.map((k) => k.keyword), ["plumber"]);
  assert.deepEqual(f.weakAds.map((a) => a.adId), ["901"]);
  assert.equal(f.landingPages[0].url, "https://acme.com/plumbing");
});

await check("metrics: the envelope, with previous null on a first sync so no change is ever shown", async () => {
  const { sync } = await syncOf();
  const m = adsanalyze.metrics(sync);
  assert.equal(m.find((x) => x.key === "cpa").value, 500);
  assert.equal(m.find((x) => x.key === "cpa").previous, 250);
  assert.equal(m.find((x) => x.key === "cpa").betterWhen, "lower");
  assert.equal(m.find((x) => x.key === "roas").value, null, "no conversion value recorded: no ratio, not 0");
  const first = adsanalyze.metrics({ ...sync, hasPrevious: false });
  assert.ok(first.every((x) => x.previous === null));
});

await check("queue rows: source-scoped ads types, stable ids, no clicks figure, money in the words", async () => {
  const { sync } = await syncOf();
  const f = adsanalyze.findings(sync, { brandWords: ["acme"] });
  const a = adsanalyze.buildActions("p1", f);
  assert.ok(a.every((x) => x.type.startsWith("ads:") && x.clicks_at_stake === 0));
  assert.deepEqual(adsanalyze.buildActions("p1", f).map((x) => x.id), a.map((x) => x.id), "a re-sync updates, never duplicates");
  const waste = a.find((x) => x.type === "ads:waste");
  assert.match(waste.detail, /₹1,500/);
  assert.equal(waste.priority, "high", "three conversions' worth is high");
});

/* ------------------------------------------------------------------ adsalerts.js */

await check("alerts: spend spike and cost-per-conversion jump with floors; disapproved; all on the ads producer only", async () => {
  const { sync } = await syncOf();
  const f = adsanalyze.findings(sync);
  const types = adsalerts.evaluate({ project: { id: "p1" }, sync, findings: f }).map((x) => x.type).sort();
  assert.deepEqual(types, ["ads:cpa-jump", "ads:disapproved", "ads:spend-spike"]);
  assert.equal(sharedProducerOf("ads:spend-spike"), "ads", "the shared map agrees, so a Search Console sync never sweeps these");
  assert.equal(adsalerts.producerOf("traffic:collapse"), "other");
  const first = adsalerts.evaluate({ project: { id: "p1" }, sync: { ...sync, hasPrevious: false }, findings: { ...f, disapproved: [] } });
  assert.deepEqual(first, [], "with nothing to compare, no change is alerted");
  const steady = { ...sync, totals: { ...sync.totals, cost: 14000 } };
  assert.ok(!adsalerts.evaluate({ project: { id: "p1" }, sync: steady, findings: { ...f, disapproved: [] } }).some((x) => x.type === "ads:spend-spike"), "+40% is not a spike");
});

/* ------------------------------------------------------------------ adscopy.js */

await check("ad copy: over-long, placeholder, invented number and unbacked claim lines are dropped with a reason, never cut", () => {
  const facts = "Acme Plumbing, Pune. 24 hour emergency callouts. Licensed plumbers.";
  const text = `Sure! {"headlines":["Emergency Plumber Pune","24 Hour Plumber Callouts","This headline is far longer than thirty chars","Plumber in [City]","Save 50% Today","Best Plumber in Pune","Licensed Plumbers","Call Now!","Licensed Plumbers"],"descriptions":["Licensed plumbers for leaks, blocked drains and repairs across Pune. Call now.","${"x".repeat(91)}"]}`;
  const r = adscopy.parseCopy(text, { businessFacts: facts });
  assert.deepEqual(r.headlines, ["Emergency Plumber Pune", "24 Hour Plumber Callouts", "Licensed Plumbers"]);
  const why = Object.fromEntries(r.dropped.map((d) => [d.text.slice(0, 20), d.why]));
  assert.match(why["This headline is far"], /longer than 30/);
  assert.match(why["Plumber in [City]"], /placeholder/);
  assert.match(why["Save 50% Today"], /number that is not in the business facts/);
  assert.match(why["Best Plumber in Pune"], /claim "best"/);
  assert.match(why["Call Now!"], /exclamation/);
  assert.equal(r.descriptions.length, 1);
  assert.equal(r.enough, false, "three headlines but one description is not an ad");
  assert.throws(() => adscopy.parseCopy("no json here"), /expected format/);
});

await check("RSA.validate: Google's counts and lengths, a real URL, one-word paths", () => {
  const ok = { headlines: ["A one", "B two", "C three"], descriptions: ["First description.", "Second description."], finalUrl: "https://acme.com/x", path1: "plumbing", path2: "pune" };
  assert.equal(adscopy.RSA.validate(ok).headlines.length, 3);
  assert.throws(() => adscopy.RSA.validate({ ...ok, headlines: ["A", "B"] }), /3 to 15/);
  assert.throws(() => adscopy.RSA.validate({ ...ok, headlines: ["A", "A", "B"] }), /3 to 15/, "duplicates do not count twice");
  assert.throws(() => adscopy.RSA.validate({ ...ok, descriptions: ["x".repeat(91), "y"] }), /Too long/);
  assert.throws(() => adscopy.RSA.validate({ ...ok, finalUrl: "javascript:alert(1)" }), /http or https|final URL/);
  assert.throws(() => adscopy.RSA.validate({ ...ok, path1: "two words" }), /one word/);
  assert.throws(() => adscopy.RSA.validate({ ...ok, path1: "", path2: "x" }), /needs a path 1/);
});

/* ------------------------------------------------------------------ adschange.js */

await check("proposals: negatives for wasted terms, +20% on an unshared budget-limited campaign, pause a low-score keyword with no conversions", async () => {
  const { sync } = await syncOf();
  const f = adsanalyze.findings(sync, { brandWords: ["acme"] });
  const p = adschange.proposalsFrom("p1", f);
  assert.deepEqual(p.filter((x) => x.kind === "add_negative").map((x) => `${x.text}|${x.match}`), ["plumber jobs|EXACT", "plumber salary|EXACT"]);
  const b = p.find((x) => x.kind === "set_budget");
  assert.equal(b.from, 1000);
  assert.equal(b.to, 1200);
  assert.deepEqual(p.filter((x) => x.kind === "pause_keyword").map((x) => x.keyword), ["plumber"]);
  const capped = adschange.proposalsFrom("p1", f, { maxDailyBudget: 1100 }).find((x) => x.kind === "set_budget");
  assert.equal(capped.to, 1100, "the ceiling caps a suggestion");
  assert.equal(adschange.proposalsFrom("p1", f, { maxDailyBudget: 900 }).find((x) => x.kind === "set_budget"), undefined, "no suggestion when the ceiling is already passed");
});

await check("the switch: no write of any kind while changes are off, and the error says who can turn them on", async () => {
  const f = fakeGads();
  const c = gads.client(TOKEN, f.impl);
  for (const conn of [null, { config: { property: CID } }, { config: { property: CID, writesAllowed: "yes" } }]) {
    await assert.rejects(adschange.apply({ client: c, customerId: CID, connection: conn, proposal: { kind: "pause_keyword", resource: `customers/${CID}/adGroupCriteria/77~888` } }), /Connect Google Ads|switched off/);
  }
  assert.equal(f.calls.length, 0, "not even a read");
});

await check("resource names: must be the right type AND this account's; GAQL injection never reaches a query", async () => {
  assert.throws(() => adschange.checkResource("adGroupCriteria", `customers/1111111111/adGroupCriteria/1~2`, CID), /different Google Ads account/);
  assert.throws(() => adschange.checkResource("campaignBudgets", `customers/${CID}/campaignBudgets/1' OR '1'='1`, CID), /not a campaignBudgets/);
  assert.throws(() => adschange.cleanKeyword("a'; DROP"), /cannot hold/);
  assert.throws(() => adschange.cleanKeyword("w ".repeat(11)), /10 words/);
  const f = fakeGads();
  await assert.rejects(adschange.apply({ client: gads.client(TOKEN, f.impl), customerId: CID, connection: writable, proposal: { kind: "add_negative", campaignId: "1 OR 1=1", text: "x", match: "EXACT" } }), /must be a number/);
  assert.equal(f.calls.length, 0);
});

await check("pause a keyword: read first, validateOnly before the real write, read back, journal with before/after; undo restores", async () => {
  const f = fakeGads();
  const c = gads.client(TOKEN, f.impl);
  const r = `customers/${CID}/adGroupCriteria/77~888`;
  const e = await adschange.apply({ client: c, customerId: CID, connection: writable, proposal: { kind: "pause_keyword", resource: r, keyword: "plumber" } });
  assert.equal(e.verified, true);
  assert.deepEqual([e.before.status, e.after.status], ["ENABLED", "PAUSED"]);
  const muts = f.calls.filter((x) => x.url.endsWith(":mutate"));
  assert.deepEqual(muts.map((x) => x.body.validateOnly), [true, false], "validated first, then written");
  assert.equal(f.acct.state.keywordStatus[r], "PAUSED");
  await assert.rejects(adschange.apply({ client: c, customerId: CID, connection: writable, proposal: { kind: "pause_keyword", resource: r } }), /paused already/);
  const u = await adschange.undo({ client: c, customerId: CID, connection: writable, entry: e });
  assert.equal(u.verified, true);
  assert.equal(f.acct.state.keywordStatus[r], "ENABLED");
});

await check("undo refuses when somebody changed the entity since — it would overwrite them", async () => {
  const f = fakeGads();
  const c = gads.client(TOKEN, f.impl);
  const r = `customers/${CID}/adGroupCriteria/77~888`;
  const e = await adschange.apply({ client: c, customerId: CID, connection: writable, proposal: { kind: "pause_keyword", resource: r } });
  f.acct.state.keywordStatus[r] = "ENABLED"; // a person switched it back on in Google Ads
  await assert.rejects(adschange.undo({ client: c, customerId: CID, connection: writable, entry: e }), /Somebody changed it since/);
  await assert.rejects(adschange.undo({ client: c, customerId: CID, connection: writable, entry: { ...e, undone_at: "x" } }), /already undone/);
});

await check("a write Google acknowledged but that did not land is recorded as NOT verified", async () => {
  const f = fakeGads(account(), { swallowWrites: true });
  const e = await adschange.apply({ client: gads.client(TOKEN, f.impl), customerId: CID, connection: writable, proposal: { kind: "pause_keyword", resource: `customers/${CID}/adGroupCriteria/77~888` } });
  assert.equal(e.verified, false);
});

await check("budgets: at most 30% per change, never above the ceiling, refused when it moved since the suggestion; undo after a cut still works", async () => {
  const f = fakeGads();
  const c = gads.client(TOKEN, f.impl);
  const r = `customers/${CID}/campaignBudgets/555`;
  await assert.rejects(adschange.apply({ client: c, customerId: CID, connection: writable, proposal: { kind: "set_budget", budgetResource: r, from: 1000, to: 1400 } }), /at most 30%/);
  await assert.rejects(adschange.apply({ client: c, customerId: CID, connection: writable, proposal: { kind: "set_budget", budgetResource: r, from: 1000, to: 1200 }, limits: { maxDailyBudget: 1100 } }), /ceiling/);
  await assert.rejects(adschange.apply({ client: c, customerId: CID, connection: writable, proposal: { kind: "set_budget", budgetResource: r, from: 900, to: 1100 } }), /not the 900/);
  await assert.rejects(adschange.apply({ client: c, customerId: CID, connection: writable, proposal: { kind: "set_budget", budgetResource: `customers/${CID}/campaignBudgets/556`, from: 500, to: 550 } }), /shared/);
  assert.equal(f.calls.filter((x) => x.url.endsWith(":mutate")).length, 0, "every refusal happened before any write");
  const cut = await adschange.apply({ client: c, customerId: CID, connection: writable, proposal: { kind: "set_budget", budgetResource: r, from: 1000, to: 700 } });
  assert.equal(cut.verified, true);
  assert.equal(f.acct.state.budgets[r].amountMicros, "700000000");
  const back = await adschange.undo({ client: c, customerId: CID, connection: writable, entry: cut });
  assert.equal(back.verified, true, "700 → 1000 is +43%, and undo is not stopped by the step rule");
  assert.equal(f.acct.state.budgets[r].amountMicros, "1000000000");
});

await check("negatives: added once, a second time is refused, undo removes exactly that one", async () => {
  const f = fakeGads();
  const c = gads.client(TOKEN, f.impl);
  const p = { kind: "add_negative", campaignId: "111", text: "Plumber Jobs", match: "EXACT" };
  const e = await adschange.apply({ client: c, customerId: CID, connection: writable, proposal: p });
  assert.equal(e.verified, true);
  assert.equal(f.acct.state.negatives[0].text, "plumber jobs");
  await assert.rejects(adschange.apply({ client: c, customerId: CID, connection: writable, proposal: p }), /already a negative/);
  await adschange.undo({ client: c, customerId: CID, connection: writable, entry: e });
  assert.equal(f.acct.state.negatives.length, 0);
});

await check("a new ad is created PAUSED, only if it passes Google's limits; undo refuses once somebody switched it on", async () => {
  const f = fakeGads();
  const c = gads.client(TOKEN, f.impl);
  const ad = { kind: "create_paused_ad", adGroupId: "77", headlines: ["Emergency Plumber Pune", "Licensed Plumbers", "24 Hour Callouts"], descriptions: ["Licensed plumbers for leaks and repairs across Pune.", "Call Acme for a plumber today."], finalUrl: "https://acme.com/plumbing" };
  await assert.rejects(adschange.apply({ client: c, customerId: CID, connection: writable, proposal: { ...ad, headlines: ["x".repeat(31), "a", "b"] } }), /Too long/);
  const e = await adschange.apply({ client: c, customerId: CID, connection: writable, proposal: ad });
  const create = f.calls.filter((x) => x.url.endsWith("adGroupAds:mutate")).pop().body.operations[0].create;
  assert.equal(create.status, "PAUSED");
  assert.equal(e.verified, true);
  f.acct.state.adStatus[e.target.resource] = "ENABLED";
  await assert.rejects(adschange.undo({ client: c, customerId: CID, connection: writable, entry: e }), /switched it on/);
});

/* ------------------------------------------------------------------ adsanalyst.js */

await check("the analyst's fact sheet carries the figures; the shared checker flags one that is not in it", async () => {
  const { sync } = await syncOf();
  const f = adsanalyze.findings(sync, { brandWords: ["acme"] });
  const facts = adsanalyst.buildFacts({ sync, findings: f });
  assert.equal(facts.totals.cpa, 500);
  assert.ok(reconcile("Cost per conversion was 500 over 40 conversions.", facts).ok);
  assert.deepEqual(reconcile("You could save 7300 a month.", facts).unsupported, ["7300"]);
  assert.match(adsanalyst.buildPrompt("why?", facts), /FACT SHEET/);
});

console.log(`ads: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
