// lib/adssync.js — read one Google Ads account for a period and the period before, and shape it into a sync AdsPilot can analyse.
//
// Read-only. Every query is GAQL through lib/gads.js. Rows are trimmed to what a person can act on (the costliest search terms, keywords
// and ads), because the result is stored as a blob per project and an account with 200,000 search terms must not become a 200,000-row
// snapshot nobody will read. The trimming is stated on the sync (`capped`) so a screen never presents the top 500 as "every search term".
//
// The window ends YESTERDAY, not today: today's cost is still filling in, and a last day that is half a day reads as a collapse.
// Conversions lag too (a click today can convert next week), which the analysis knows: see adsanalyze.js on the newest days.

import { fromMicros } from "./gads.js";

export const CAPS = { searchTerms: 500, keywords: 500, ads: 300, campaigns: 200 };
export const DEFAULT_DAYS = 28;

const iso = (d) => d.toISOString().slice(0, 10);

/** The current and previous windows, each `days` long, the current one ending yesterday (UTC). */
export function windows(days = DEFAULT_DAYS, now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  const pEnd = new Date(start.getTime() - 86_400_000);
  const pStart = new Date(pEnd.getTime() - (days - 1) * 86_400_000);
  return { current: { start: iso(start), end: iso(end) }, previous: { start: iso(pStart), end: iso(pEnd) }, days };
}

const during = (w) => `segments.date BETWEEN '${w.start}' AND '${w.end}'`;

/** The queries, in one place so a test can read them and a reviewer can check them against the GAQL reference in one sitting. */
export function queries(w) {
  return {
    account: `SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value FROM customer WHERE ${during(w.current)}`,
    accountPrev: `SELECT customer.id, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value FROM customer WHERE ${during(w.previous)}`,
    campaigns: `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.bidding_strategy_type, campaign_budget.resource_name, campaign_budget.amount_micros, campaign_budget.explicitly_shared, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value, metrics.search_budget_lost_impression_share, metrics.search_impression_share FROM campaign WHERE campaign.status != 'REMOVED' AND ${during(w.current)} ORDER BY metrics.cost_micros DESC LIMIT ${CAPS.campaigns}`,
    searchTerms: `SELECT search_term_view.search_term, search_term_view.status, campaign.id, campaign.name, ad_group.id, ad_group.name, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value FROM search_term_view WHERE ${during(w.current)} ORDER BY metrics.cost_micros DESC LIMIT ${CAPS.searchTerms}`,
    keywords: `SELECT ad_group_criterion.resource_name, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, ad_group_criterion.quality_info.quality_score, campaign.id, campaign.name, ad_group.id, ad_group.name, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM keyword_view WHERE ad_group_criterion.status != 'REMOVED' AND ${during(w.current)} ORDER BY metrics.cost_micros DESC LIMIT ${CAPS.keywords}`,
    ads: `SELECT ad_group_ad.resource_name, ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.ad.final_urls, ad_group_ad.status, ad_group_ad.policy_summary.approval_status, ad_group_ad.ad_strength, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, campaign.id, campaign.name, ad_group.id, ad_group.name, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED' AND ${during(w.current)} ORDER BY metrics.cost_micros DESC LIMIT ${CAPS.ads}`,
  };
}

const num = (v) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
/** Impression share comes back as 0–1. Google sends nothing at all when it has no figure, and that is kept as null, not 0. */
const share = (v) => (num(v) === null ? null : Math.round(num(v) * 1000) / 10);

function metricsOf(m = {}) {
  return {
    cost: fromMicros(m.costMicros) ?? 0,
    clicks: num(m.clicks) ?? 0,
    impressions: num(m.impressions) ?? 0,
    conversions: num(m.conversions) ?? 0,
    value: num(m.conversionsValue) ?? 0,
  };
}

/** Sum the per-day customer rows (the query is segmented by the WHERE on date, which returns one row per day in some versions). */
function totalOf(rows) {
  const t = { cost: 0, clicks: 0, impressions: 0, conversions: 0, value: 0 };
  for (const r of rows) {
    const m = metricsOf(r.metrics);
    for (const k of Object.keys(t)) t[k] += m[k];
  }
  for (const k of Object.keys(t)) t[k] = Math.round(t[k] * 100) / 100;
  return t;
}

/** Raw GAQL rows → the shape analysis reads. Pure, so it is tested with recorded-looking rows and no network. */
export function shape({ account, accountPrev, campaigns, searchTerms, keywords, ads }, w) {
  const acct = account[0]?.customer || {};
  return {
    account: { id: String(acct.id || ""), name: acct.descriptiveName || "", currency: acct.currencyCode || "", timeZone: acct.timeZone || "" },
    range: w,
    totals: totalOf(account),
    previous: totalOf(accountPrev),
    hasPrevious: accountPrev.length > 0,
    campaigns: campaigns.map((r) => ({
      id: String(r.campaign?.id || ""),
      name: r.campaign?.name || "",
      status: r.campaign?.status || "",
      channel: r.campaign?.advertisingChannelType || "",
      bidding: r.campaign?.biddingStrategyType || "",
      budgetResource: r.campaignBudget?.resourceName || "",
      budget: fromMicros(r.campaignBudget?.amountMicros),
      budgetShared: !!r.campaignBudget?.explicitlyShared,
      lostToBudget: share(r.metrics?.searchBudgetLostImpressionShare),
      impressionShare: share(r.metrics?.searchImpressionShare),
      ...metricsOf(r.metrics),
    })),
    searchTerms: searchTerms.map((r) => ({
      term: r.searchTermView?.searchTerm || "",
      status: r.searchTermView?.status || "",
      campaignId: String(r.campaign?.id || ""),
      campaign: r.campaign?.name || "",
      adGroupId: String(r.adGroup?.id || ""),
      adGroup: r.adGroup?.name || "",
      ...metricsOf(r.metrics),
    })),
    keywords: keywords.map((r) => ({
      resource: r.adGroupCriterion?.resourceName || "",
      id: String(r.adGroupCriterion?.criterionId || ""),
      text: r.adGroupCriterion?.keyword?.text || "",
      match: r.adGroupCriterion?.keyword?.matchType || "",
      status: r.adGroupCriterion?.status || "",
      qualityScore: num(r.adGroupCriterion?.qualityInfo?.qualityScore),
      campaignId: String(r.campaign?.id || ""),
      campaign: r.campaign?.name || "",
      adGroupId: String(r.adGroup?.id || ""),
      adGroup: r.adGroup?.name || "",
      ...metricsOf(r.metrics),
    })),
    ads: ads.map((r) => ({
      resource: r.adGroupAd?.resourceName || "",
      id: String(r.adGroupAd?.ad?.id || ""),
      type: r.adGroupAd?.ad?.type || "",
      finalUrls: r.adGroupAd?.ad?.finalUrls || [],
      status: r.adGroupAd?.status || "",
      approval: r.adGroupAd?.policySummary?.approvalStatus || "",
      strength: r.adGroupAd?.adStrength || "",
      headlines: (r.adGroupAd?.ad?.responsiveSearchAd?.headlines || []).map((h) => h.text).filter(Boolean),
      descriptions: (r.adGroupAd?.ad?.responsiveSearchAd?.descriptions || []).map((h) => h.text).filter(Boolean),
      campaignId: String(r.campaign?.id || ""),
      campaign: r.campaign?.name || "",
      adGroupId: String(r.adGroup?.id || ""),
      adGroup: r.adGroup?.name || "",
      ...metricsOf(r.metrics),
    })),
    capped: {
      searchTerms: searchTerms.length >= CAPS.searchTerms,
      keywords: keywords.length >= CAPS.keywords,
      ads: ads.length >= CAPS.ads,
      campaigns: campaigns.length >= CAPS.campaigns,
    },
  };
}

/**
 * Fetch and shape. `gadsClient` is a lib/gads.js client. A failing query FAILS THE SYNC rather than producing a partial one: a sync with
 * campaigns but no search terms would raise "no wasted spend" as a finding, which is a claim about money made from data never read.
 */
export async function fetchAds(gadsClient, customerId, { days = DEFAULT_DAYS, now = new Date() } = {}) {
  const w = windows(days, now);
  const q = queries(w);
  const out = {};
  for (const [k, query] of Object.entries(q)) out[k] = await gadsClient.search(customerId, query);
  return { ...shape(out, w), synced_at: new Date().toISOString() };
}
