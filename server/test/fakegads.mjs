// server/test/fakegads.mjs — a fake Google Ads REST API for the AdsPilot tests. Not a test file (not in the `test` chain); imported by them.
//
// It answers the exact requests lib/gads.js makes, keeps a little mutable account (statuses, budgets, negatives, ads) so a write can be read
// back, records every call so a test can assert WHAT was sent (headers, validateOnly first, nothing at all), and can be told to fail or to
// "acknowledge a write that does not land". It does not try to be Google: it is shaped to the queries in lib/adssync.js and lib/adschange.js.

const CID = "1234567890";
const MGR = "9999999999";

export function account() {
  return {
    customer: { id: CID, descriptiveName: "Acme Plumbing", currencyCode: "INR", timeZone: "Asia/Kolkata" },
    totals: { costMicros: "20000000000", clicks: "2000", impressions: "40000", conversions: 40, conversionsValue: 0 }, // ₹20,000, 40 conv → CPA ₹500
    previous: { costMicros: "10000000000", clicks: "1500", impressions: "30000", conversions: 40, conversionsValue: 0 },
    campaigns: [
      { campaign: { id: "111", name: "Search - Plumbing", status: "ENABLED", advertisingChannelType: "SEARCH", biddingStrategyType: "MAXIMIZE_CONVERSIONS" }, campaignBudget: { resourceName: `customers/${CID}/campaignBudgets/555`, amountMicros: "1000000000", explicitlyShared: false }, metrics: { costMicros: "15000000000", clicks: "1500", impressions: "30000", conversions: 36, searchBudgetLostImpressionShare: 0.25, searchImpressionShare: 0.6 } },
      { campaign: { id: "222", name: "Display - Brand", status: "ENABLED", advertisingChannelType: "DISPLAY" }, campaignBudget: { resourceName: `customers/${CID}/campaignBudgets/556`, amountMicros: "500000000", explicitlyShared: true }, metrics: { costMicros: "5000000000", clicks: "500", impressions: "10000", conversions: 4 } },
    ],
    searchTerms: [
      { searchTermView: { searchTerm: "plumber jobs", status: "NONE" }, campaign: { id: "111", name: "Search - Plumbing" }, adGroup: { id: "77", name: "Plumbers" }, metrics: { costMicros: "1500000000", clicks: "30", impressions: "400", conversions: 0 } },
      { searchTermView: { searchTerm: "plumber salary", status: "NONE" }, campaign: { id: "111", name: "Search - Plumbing" }, adGroup: { id: "77", name: "Plumbers" }, metrics: { costMicros: "600000000", clicks: "12", impressions: "200", conversions: 0 } },
      { searchTermView: { searchTerm: "plumber jobs near me", status: "NONE" }, campaign: { id: "111", name: "Search - Plumbing" }, adGroup: { id: "77", name: "Plumbers" }, metrics: { costMicros: "300000000", clicks: "6", impressions: "100", conversions: 0 } },
      { searchTermView: { searchTerm: "acme plumbing reviews", status: "NONE" }, campaign: { id: "111", name: "Search - Plumbing" }, adGroup: { id: "77", name: "Plumbers" }, metrics: { costMicros: "900000000", clicks: "20", impressions: "300", conversions: 0 } },
      { searchTermView: { searchTerm: "emergency plumber", status: "NONE" }, campaign: { id: "111", name: "Search - Plumbing" }, adGroup: { id: "77", name: "Plumbers" }, metrics: { costMicros: "5000000000", clicks: "400", impressions: "6000", conversions: 30 } },
      { searchTermView: { searchTerm: "cheap plumber", status: "NONE" }, campaign: { id: "111", name: "Search - Plumbing" }, adGroup: { id: "77", name: "Plumbers" }, metrics: { costMicros: "100000000", clicks: "3", impressions: "50", conversions: 0 } },
    ],
    keywords: [
      { adGroupCriterion: { resourceName: `customers/${CID}/adGroupCriteria/77~888`, criterionId: "888", keyword: { text: "plumber", matchType: "BROAD" }, status: "ENABLED", qualityInfo: { qualityScore: 2 } }, campaign: { id: "111", name: "Search - Plumbing" }, adGroup: { id: "77", name: "Plumbers" }, metrics: { costMicros: "2000000000", clicks: "60", impressions: "2000", conversions: 0 } },
      { adGroupCriterion: { resourceName: `customers/${CID}/adGroupCriteria/77~889`, criterionId: "889", keyword: { text: "emergency plumber", matchType: "PHRASE" }, status: "ENABLED", qualityInfo: { qualityScore: 8 } }, campaign: { id: "111", name: "Search - Plumbing" }, adGroup: { id: "77", name: "Plumbers" }, metrics: { costMicros: "9000000000", clicks: "900", impressions: "20000", conversions: 30 } },
    ],
    ads: [
      { adGroupAd: { resourceName: `customers/${CID}/adGroupAds/77~901`, ad: { id: "901", type: "RESPONSIVE_SEARCH_AD", finalUrls: ["https://acme.com/plumbing"], responsiveSearchAd: { headlines: [{ text: "Plumber in Pune" }, { text: "Call Acme" }], descriptions: [{ text: "Plumbing repairs." }] } }, status: "ENABLED", policySummary: { approvalStatus: "APPROVED" }, adStrength: "POOR" }, campaign: { id: "111", name: "Search - Plumbing" }, adGroup: { id: "77", name: "Plumbers" }, metrics: { costMicros: "10000000000", clicks: "1000", impressions: "20000", conversions: 30 } },
      { adGroupAd: { resourceName: `customers/${CID}/adGroupAds/77~902`, ad: { id: "902", type: "RESPONSIVE_SEARCH_AD", finalUrls: ["https://acme.com/offer"] }, status: "ENABLED", policySummary: { approvalStatus: "DISAPPROVED" }, adStrength: "GOOD" }, campaign: { id: "111", name: "Search - Plumbing" }, adGroup: { id: "77", name: "Plumbers" }, metrics: { costMicros: "0", clicks: "0", impressions: "0", conversions: 0 } },
    ],
    // Mutable state that writes act on and reads see.
    state: {
      keywordStatus: { [`customers/${CID}/adGroupCriteria/77~888`]: "ENABLED", [`customers/${CID}/adGroupCriteria/77~889`]: "ENABLED" },
      budgets: { [`customers/${CID}/campaignBudgets/555`]: { amountMicros: "1000000000", explicitlyShared: false }, [`customers/${CID}/campaignBudgets/556`]: { amountMicros: "500000000", explicitlyShared: true } },
      negatives: [], // { resourceName, campaignId, text, matchType }
      adStatus: {},
      nextId: 1000,
    },
  };
}

/**
 * fetch-shaped fake. Options:
 *   failWith: { status, body }  — every call fails with this
 *   swallowWrites: true         — mutates answer success but change nothing (the "acknowledged but did not land" case)
 *   accessible: [...]           — what listAccessibleCustomers returns
 */
export function fakeGads(acct = account(), opts = {}) {
  const calls = [];
  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
  const str = (q, re) => (q.match(re) || [])[1];

  async function impl(url, init = {}) {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: u.pathname, method: init.method, headers: init.headers || {}, body });
    if (opts.failWith) return json(opts.failWith.status, opts.failWith.body);

    if (u.pathname.endsWith("customers:listAccessibleCustomers")) return json(200, { resourceNames: (opts.accessible || [CID]).map((c) => `customers/${c}`) });

    const search = u.pathname.match(/customers\/(\d+)\/googleAds:search$/);
    if (search) {
      const q = body.query;
      const S = acct.state;
      const res = (results) => json(200, { results });
      if (/FROM customer_client/.test(q)) return res(opts.clients || []);
      if (/FROM customer\b/.test(q) && /LIMIT 1/.test(q)) return res([{ customer: { id: search[1], descriptiveName: search[1] === MGR ? "Agency MCC" : acct.customer.descriptiveName, manager: search[1] === MGR, currencyCode: "INR" } }]);
      if (/FROM customer\b/.test(q)) return res([/descriptive_name/.test(q) ? { customer: acct.customer, metrics: acct.totals } : { customer: { id: CID }, metrics: acct.previous }]);
      if (/FROM campaign\b/.test(q)) return res(acct.campaigns);
      if (/FROM search_term_view/.test(q)) return res(acct.searchTerms);
      if (/FROM keyword_view/.test(q)) return res(acct.keywords);
      if (/FROM campaign_criterion/.test(q)) {
        const cid = str(q, /campaign\.id = (\d+)/);
        const text = str(q, /keyword\.text = '((?:[^'\\]|\\.)*)'/)?.replace(/\\'/g, "'");
        const mt = str(q, /match_type = '(\w+)'/);
        return res(S.negatives.filter((n) => n.campaignId === cid && n.text === text && n.matchType === mt).map((n) => ({ campaignCriterion: { resourceName: n.resourceName } })));
      }
      if (/FROM ad_group_criterion/.test(q)) {
        const r = str(q, /resource_name = '([^']+)'/);
        return res(S.keywordStatus[r] ? [{ adGroupCriterion: { status: S.keywordStatus[r] } }] : []);
      }
      if (/FROM campaign_budget/.test(q)) {
        const r = str(q, /resource_name = '([^']+)'/);
        return res(S.budgets[r] ? [{ campaignBudget: S.budgets[r] }] : []);
      }
      if (/FROM ad_group_ad WHERE ad_group_ad\.resource_name/.test(q)) {
        const r = str(q, /resource_name = '([^']+)'/);
        return res(S.adStatus[r] ? [{ adGroupAd: { status: S.adStatus[r] } }] : []);
      }
      if (/FROM ad_group_ad/.test(q)) return res(acct.ads);
      return json(400, { error: { message: `fake does not know: ${q.slice(0, 80)}` } });
    }

    const mut = u.pathname.match(/customers\/(\d+)\/(\w+):mutate$/);
    if (mut) {
      const [, cid, service] = mut;
      const S = acct.state;
      const names = [];
      for (const op of body.operations) {
        if (service === "campaignCriteria" && op.create) {
          const campaignId = op.create.campaign.split("/").pop();
          const rn = `customers/${cid}/campaignCriteria/${campaignId}~${S.nextId++}`;
          names.push(rn);
          if (!body.validateOnly && !opts.swallowWrites) S.negatives.push({ resourceName: rn, campaignId, text: op.create.keyword.text, matchType: op.create.keyword.matchType });
        } else if (service === "campaignCriteria" && op.remove) {
          names.push(op.remove);
          if (!body.validateOnly && !opts.swallowWrites) S.negatives = S.negatives.filter((n) => n.resourceName !== op.remove);
        } else if (service === "adGroupCriteria" && op.update) {
          names.push(op.update.resourceName);
          if (!body.validateOnly && !opts.swallowWrites) S.keywordStatus[op.update.resourceName] = op.update.status;
        } else if (service === "campaignBudgets" && op.update) {
          names.push(op.update.resourceName);
          if (!body.validateOnly && !opts.swallowWrites) S.budgets[op.update.resourceName].amountMicros = op.update.amountMicros;
        } else if (service === "adGroupAds" && op.create) {
          const ag = op.create.adGroup.split("/").pop();
          const rn = `customers/${cid}/adGroupAds/${ag}~${S.nextId++}`;
          names.push(rn);
          if (!body.validateOnly && !opts.swallowWrites) S.adStatus[rn] = op.create.status;
        } else if (service === "adGroupAds" && op.remove) {
          names.push(op.remove);
          if (!body.validateOnly && !opts.swallowWrites) delete S.adStatus[op.remove];
        } else return json(400, { error: { message: `fake cannot mutate ${service}` } });
      }
      return json(200, { results: body.validateOnly ? [] : names.map((resourceName) => ({ resourceName })) });
    }
    return json(404, { error: { message: `no route ${u.pathname}` } });
  }
  return { impl, calls, acct };
}

export { CID, MGR };
