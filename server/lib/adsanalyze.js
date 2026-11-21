// lib/adsanalyze.js — one Google Ads sync in, findings and queue rows out. Pure: no store, no network, no clock.
//
// The same discipline as analyze.js, for money instead of clicks:
//   · Every finding carries its evidence (the cost, the clicks, the conversions it was derived from) so nobody has to reopen Google Ads to
//     believe it.
//   · null is not 0. A figure Google did not send (impression share on a campaign type that has none) is "not reported", never a zero.
//   · With nothing to compare against, say nothing about change.
//   · "Wasted" is a judgement, so it is made against the account's OWN cost per conversion, never a fixed number of rupees: ₹500 with no
//     conversion is waste on an account converting at ₹200 and normal on one converting at ₹5,000.
//   · An account recording NO conversions at all is not judged for waste. With no conversions anywhere, every search term looks wasted,
//     and the honest finding is the tracking one, not two hundred negative keywords.
//
// Conversion lag: a click in the last few days of the window may still convert. The thresholds below ask for a FULL conversion's worth of
// spend and at least MIN_CLICKS clicks before calling a term wasted, which is deliberately conservative; the screen also says so.

import { actionKey } from "./ids.js";

export const MIN_CLICKS = 5;
export const MAX_WASTED = 25;
export const BUDGET_LOST_MIN = 10; // % of impressions lost to budget before a campaign is called budget-limited
export const MIN_CONV_FOR_BUDGET = 3;
export const LOW_QS = 3;
export const NGRAM_MIN_TERMS = 3;

const round2 = (n) => Math.round(n * 100) / 100;
const ratio = (a, b) => (b > 0 ? a / b : null);

/** Money for prose, in the account's currency. Falls back to "CODE 1,234.50" where Intl cannot format the code. */
export function money(v, currency = "") {
  if (v === null || v === undefined) return "not reported";
  try {
    if (currency) return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(v);
  } catch {
    /* fall through */
  }
  return `${currency ? `${currency} ` : ""}${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** The account's own efficiency. cpa is null when there were no conversions; roas is null when no value was recorded. */
export function accountKpis(t) {
  return {
    cost: round2(t.cost),
    clicks: t.clicks,
    impressions: t.impressions,
    conversions: round2(t.conversions),
    value: round2(t.value),
    cpa: t.conversions > 0 ? round2(t.cost / t.conversions) : null,
    roas: t.cost > 0 && t.value > 0 ? round2(t.value / t.cost) : null,
    ctr: t.impressions > 0 ? round2((t.clicks / t.impressions) * 100) : null,
    cpc: t.clicks > 0 ? round2(t.cost / t.clicks) : null,
  };
}

/**
 * The headline, in the same self-describing envelope SEOPilot's screens already render (key, label, value, previous, format, betterWhen).
 * `previous` is null on a first sync, and the screen then shows no change at all.
 */
export function metrics(sync) {
  const now = accountKpis(sync.totals);
  const before = sync.hasPrevious ? accountKpis(sync.previous) : null;
  const row = (key, label, format, betterWhen) => ({ key, label, value: now[key], previous: before ? before[key] : null, format, betterWhen });
  return [
    row("cost", "Cost", "money", "lower"),
    row("conversions", "Conversions", "number", "higher"),
    row("cpa", "Cost per conversion", "money", "lower"),
    row("roas", "Conversion value / cost", "ratio", "higher"),
    row("clicks", "Clicks", "number", "higher"),
    row("ctr", "Click-through rate", "percent", "higher"),
  ];
}

/** Lower-case words of a search term, without the very short ones that carry no meaning on their own. */
const words = (s) => String(s || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);

/**
 * Everything the account sync supports saying, as plain data. Each list is already ranked.
 * `brandWords` are words in the business's own name: a search for the brand is never suggested as a negative, whatever it cost.
 */
export function findings(sync, { brandWords = [] } = {}) {
  const k = accountKpis(sync.totals);
  const cpa = k.cpa;
  const brand = new Set(brandWords.flatMap(words));
  const out = { kpis: k, currency: sync.account?.currency || "", tracking: null, wastedTerms: [], negativeWords: [], budgetLimited: [], disapproved: [], lowQuality: [], weakAds: [], landingPages: [], notes: [] };

  /* --- conversion tracking first: every waste judgement below depends on it ------------------------------------------- */
  if (k.cost > 0 && k.conversions === 0) {
    const before = sync.hasPrevious ? accountKpis(sync.previous) : null;
    out.tracking =
      before && before.conversions > 0
        ? { kind: "stopped", cost: k.cost, previousConversions: before.conversions, detail: `${money(k.cost, out.currency)} was spent with no conversion recorded, after ${before.conversions} conversions in the period before. Either conversions really stopped or the tracking broke; both need looking at today.` }
        : { kind: "none", cost: k.cost, detail: `${money(k.cost, out.currency)} was spent and no conversion was recorded in either period. Either conversion tracking is not set up, or it is not recording. Until it is, no keyword or search term can be judged on results.` };
    out.notes.push("No conversions were recorded, so search terms and keywords were not judged as wasted.");
  }

  /* --- wasted search terms -------------------------------------------------------------------------------------------- */
  if (cpa !== null) {
    const isBrand = (t) => words(t).some((w) => brand.has(w));
    out.wastedTerms = sync.searchTerms
      .filter((t) => t.conversions === 0 && t.clicks >= MIN_CLICKS && t.cost >= cpa && t.status !== "EXCLUDED" && !isBrand(t.term))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, MAX_WASTED)
      .map((t) => ({ term: t.term, campaignId: t.campaignId, campaign: t.campaign, adGroup: t.adGroup, cost: round2(t.cost), clicks: t.clicks, impressions: t.impressions, timesCpa: round2(t.cost / cpa) }));

    // A word shared by several wasted terms, and found in NO term that converted, is a phrase-negative candidate. Both conditions,
    // because "cheap" across five wasted terms is useless as a negative if "cheap dentist near me" brought three patients.
    const converting = new Set(sync.searchTerms.filter((t) => t.conversions > 0).flatMap((t) => words(t.term)));
    const byWord = new Map();
    for (const t of sync.searchTerms.filter((x) => x.conversions === 0 && x.status !== "EXCLUDED")) {
      for (const w of new Set(words(t.term))) {
        if (converting.has(w) || brand.has(w)) continue;
        const e = byWord.get(w) || { word: w, terms: 0, cost: 0, clicks: 0, campaigns: new Set() };
        e.terms += 1;
        e.cost += t.cost;
        e.clicks += t.clicks;
        e.campaigns.add(t.campaignId);
        byWord.set(w, e);
      }
    }
    out.negativeWords = [...byWord.values()]
      .filter((e) => e.terms >= NGRAM_MIN_TERMS && e.cost >= cpa && e.clicks >= MIN_CLICKS)
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 15)
      .map((e) => ({ word: e.word, terms: e.terms, cost: round2(e.cost), clicks: e.clicks, campaignIds: [...e.campaigns] }));
  }

  /* --- budget-limited campaigns that earn their money ----------------------------------------------------------------- */
  out.budgetLimited = sync.campaigns
    .filter((c) => c.status === "ENABLED" && c.lostToBudget !== null && c.lostToBudget >= BUDGET_LOST_MIN && c.conversions >= MIN_CONV_FOR_BUDGET)
    .map((c) => ({ ...c, cpa: round2(c.cost / c.conversions) }))
    // Only a campaign at least as efficient as the account: more budget for a campaign that converts expensively is more expensive conversions.
    .filter((c) => cpa === null || c.cpa <= cpa)
    .sort((a, b) => b.lostToBudget - a.lostToBudget)
    .map((c) => ({ campaignId: c.id, campaign: c.name, budget: c.budget, budgetResource: c.budgetResource, shared: c.budgetShared, lostToBudget: c.lostToBudget, cpa: c.cpa, conversions: c.conversions, cost: round2(c.cost) }));

  /* --- ads Google has disapproved, that are switched on and so are simply not running ---------------------------------- */
  out.disapproved = sync.ads
    .filter((a) => a.status === "ENABLED" && a.approval === "DISAPPROVED")
    .map((a) => ({ adId: a.id, campaign: a.campaign, adGroup: a.adGroup, finalUrl: a.finalUrls[0] || "" }));

  /* --- keywords with a very low quality score that are still spending ------------------------------------------------- */
  out.lowQuality = sync.keywords
    .filter((kw) => kw.status === "ENABLED" && kw.qualityScore !== null && kw.qualityScore <= LOW_QS && kw.clicks >= MIN_CLICKS)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 20)
    .map((kw) => ({ resource: kw.resource, keyword: kw.text, match: kw.match, qualityScore: kw.qualityScore, campaign: kw.campaign, adGroup: kw.adGroup, adGroupId: kw.adGroupId, cost: round2(kw.cost), clicks: kw.clicks, conversions: kw.conversions }));

  /* --- responsive search ads Google itself rates Poor, that are actually being shown --------------------------------- */
  out.weakAds = sync.ads
    .filter((a) => a.status === "ENABLED" && a.approval !== "DISAPPROVED" && a.strength === "POOR" && a.impressions >= 100)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 15)
    .map((a) => ({ adId: a.id, campaign: a.campaign, adGroup: a.adGroup, adGroupId: a.adGroupId, impressions: a.impressions, headlines: a.headlines.length, descriptions: a.descriptions.length, finalUrl: a.finalUrls[0] || "" }));

  /* --- landing pages, by the money sent to them: what to measure for speed and to hand to DevPilot ---------------------- */
  const pages = new Map();
  for (const a of sync.ads.filter((x) => x.status === "ENABLED")) {
    const u = a.finalUrls[0];
    if (!u) continue;
    const e = pages.get(u) || { url: u, cost: 0, clicks: 0, conversions: 0, ads: 0 };
    e.cost += a.cost;
    e.clicks += a.clicks;
    e.conversions += a.conversions;
    e.ads += 1;
    pages.set(u, e);
  }
  out.landingPages = [...pages.values()].sort((a, b) => b.cost - a.cost).slice(0, 20).map((p) => ({ ...p, cost: round2(p.cost), conversions: round2(p.conversions) }));

  if (sync.capped?.searchTerms) out.notes.push(`Only the costliest search terms were read (the account has more). Cheaper terms are not judged here.`);
  return out;
}

function priority(cost, cpa) {
  if (cpa === null) return "medium";
  if (cost >= cpa * 3) return "high";
  if (cost >= cpa) return "medium";
  return "low";
}

/**
 * Findings → the shared work queue, as source "gads". `clicks_at_stake` stays 0 (nothing here is a clicks figure; the queue shows no number
 * rather than "0 clicks at stake" beside real waste) and the money is in `evidence.cost` and in the words.
 */
export function buildActions(projectId, f) {
  const cur = f.currency;
  const cpa = f.kpis.cpa;
  const drafts = [];
  const push = (type, subject, title, detail, prio, evidence) =>
    drafts.push({ id: actionKey(projectId, `ads:${type}`, subject), project_id: projectId, type: `ads:${type}`, subject, title, detail, clicks_at_stake: 0, priority: prio, evidence });

  if (f.tracking) push(`tracking-${f.tracking.kind}`, "account", f.tracking.kind === "stopped" ? "Conversions stopped recording" : "No conversions are being recorded", f.tracking.detail, "high", { cost: f.tracking.cost });
  for (const t of f.wastedTerms) push("waste", `${t.campaignId}|${t.term}`, `Add "${t.term}" as a negative keyword`, `${money(t.cost, cur)} over ${t.clicks} clicks in ${t.campaign}, with no conversion. That is ${t.timesCpa}× what a conversion costs this account.`, priority(t.cost, cpa), t);
  for (const w of f.negativeWords) push("negword", w.word, `Consider "${w.word}" as a phrase negative`, `${w.terms} search terms containing "${w.word}" spent ${money(w.cost, cur)} with no conversion, and no search term that converted contains it.`, priority(w.cost, cpa), w);
  for (const c of f.budgetLimited) push("budget", c.campaignId, `Raise the budget on ${c.campaign}`, `It lost ${c.lostToBudget}% of the impressions it could have had to its budget, while converting at ${money(c.cpa, cur)} — no worse than the account's ${money(cpa, cur)}.${c.shared ? " Its budget is shared with other campaigns, so change it in Google Ads." : ""}`, c.lostToBudget >= 30 ? "high" : "medium", c);
  for (const a of f.disapproved) push("disapproved", a.adId, `An ad in ${a.adGroup} is disapproved`, `It is switched on but Google is not showing it. Open it in Google Ads to see the policy reason; AdsPilot does not edit policy issues.`, "high", a);
  for (const kw of f.lowQuality) push("lowqs", kw.resource, `Quality Score ${kw.qualityScore} on "${kw.keyword}"`, `${money(kw.cost, cur)} over ${kw.clicks} clicks in ${kw.adGroup}. A score this low usually means the ad or landing page does not match the search: rewrite the ad, fix the page, or pause the keyword.`, priority(kw.cost, cpa), kw);
  for (const a of f.weakAds) push("weakad", a.adId, `Google rates an ad in ${a.adGroup} "Poor"`, `Shown ${a.impressions} times with ${a.headlines} headlines and ${a.descriptions} descriptions. AdsPilot can draft new ones to choose from.`, "medium", a);
  return drafts;
}
