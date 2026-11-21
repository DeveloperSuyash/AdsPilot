// lib/adschange.js — the only code in AdsPilot that changes a Google Ads account.
//
// A change here spends or stops spending somebody's real money, so every write follows DevPilot's recovery rule (snapshot, change, check,
// undo) as it was built for Webflow (webflow-undo.js), adapted to an API where nothing is ever "deployed":
//
//   1. PROPOSALS are made from findings by pure code (`proposalsFrom`). The model never names a change. A person approves each one.
//   2. Writing is OFF until a workspace owner or admin turns it on for that account (`assertWritable`). The `adwords` scope cannot be read-only,
//      so this flag is the read-only boundary, and it is checked here, at the single place a write happens, not in a route.
//   3. Before a write the CURRENT state is read back from Google. If it cannot be read, or is not what the proposal expected, the write is
//      refused: a proposal made from Tuesday's sync must not overwrite a budget somebody changed by hand on Wednesday.
//   4. Every write is first sent with validateOnly, so a change Google would refuse is refused before it is attempted for real.
//   5. After the write the entity is read AGAIN. A write Google acknowledged but that did not land reads "unverified", never "done".
//   6. The journal keeps before and after. Undo replays the inverse, and refuses if the entity has moved since (it would overwrite a person).
//
// Limits on money are code, not prompts: a budget change is at most BUDGET_MAX_STEP of the current budget per change, and never above the
// project's ceiling when one is set. New ads are created PAUSED, so creating one spends nothing until a person switches it on in Google Ads.
//
// Not verified against the real API (developers.google.com was unreachable when this was written): the mutate bodies follow the REST
// reference from memory and are tested against fakes. Run one of each on a test account before switching writes on for a client.

import { actionKey } from "./ids.js";
import { cleanCid, fromMicros, toMicros } from "./gads.js";
import { RSA } from "./adscopy.js";

export const BUDGET_SUGGEST_STEP = 0.2; // what a proposal suggests
export const BUDGET_MAX_STEP = 0.3; // the most any single change may move a budget, up or down, whoever asked
export const KINDS = ["add_negative", "pause_keyword", "set_budget", "create_paused_ad"];

/** The one gate. Called by every apply and every undo. */
export function assertWritable(connection) {
  if (!connection) throw new Error("Connect Google Ads first.");
  if (connection.config?.writesAllowed !== true) {
    throw new Error("Changes are switched off for this Google Ads account. A workspace owner or admin can allow them under Ads → Settings; until then AdsPilot only reads and suggests.");
  }
}

/** Keyword text a negative may carry: letters, digits, spaces and a few marks, at most 80 characters and 10 words (Google's own limits). */
export function cleanKeyword(text) {
  const t = String(text || "").trim().replace(/\s+/g, " ").toLowerCase();
  if (!t) throw new Error("A negative keyword cannot be empty.");
  if (t.length > 80 || t.split(" ").length > 10) throw new Error(`"${t.slice(0, 40)}…" is longer than Google allows for a keyword (80 characters, 10 words).`);
  if (!/^[\p{L}\p{N} &'.+\-]+$/u.test(t)) throw new Error(`"${t}" contains characters a keyword cannot hold.`);
  return t;
}

/** GAQL string literal. Keyword text is already restricted by cleanKeyword; this is the second lock, not the first. */
const lit = (s) => `'${String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

const RESOURCE = {
  adGroupCriteria: /^customers\/(\d{10})\/adGroupCriteria\/\d+~\d+$/,
  campaignBudgets: /^customers\/(\d{10})\/campaignBudgets\/\d+$/,
  adGroupAds: /^customers\/(\d{10})\/adGroupAds\/\d+~\d+$/,
  campaignCriteria: /^customers\/(\d{10})\/campaignCriteria\/\d+~\d+$/,
};

/** A resource name of the expected type AND of this account. Anything else is refused before it reaches a query or a mutate. */
export function checkResource(kind, name, customerId) {
  const m = RESOURCE[kind]?.exec(String(name || ""));
  if (!m) throw new Error(`"${name}" is not a ${kind} resource name.`);
  if (m[1] !== cleanCid(customerId)) throw new Error("That item belongs to a different Google Ads account.");
  return name;
}
const numericId = (v, what) => {
  const s = String(v || "");
  if (!/^\d+$/.test(s)) throw new Error(`${what} must be a number.`);
  return s;
};

/* ------------------------------------------------------------------ proposals (pure) */

/**
 * Findings → proposed changes, each with a stable id so a re-sync updates rather than duplicates, and a reason in words.
 * Only things a proposal can do safely and reversibly are proposed. Disapproved ads and Quality Score are NOT auto-proposed as edits: the fix
 * there is a better ad or page, which is a person's (or the ad-copy screen's) decision.
 */
export function proposalsFrom(projectId, f, { maxDailyBudget = null } = {}) {
  const out = [];
  const add = (kind, subject, p) => out.push({ id: actionKey(projectId, `adsprop:${kind}`, subject), kind, ...p });

  for (const t of f.wastedTerms || []) {
    let text;
    try {
      text = cleanKeyword(t.term);
    } catch {
      continue; // a term Google itself would not take as a keyword is not proposed, never trimmed into something else
    }
    add("add_negative", `${t.campaignId}|exact|${text}`, { campaignId: t.campaignId, campaign: t.campaign, text, match: "EXACT", reason: `"${t.term}" spent ${t.cost} over ${t.clicks} clicks with no conversion.`, cost: t.cost });
  }
  for (const w of f.negativeWords || []) {
    for (const cid of (w.campaignIds || []).slice(0, 5)) {
      let text;
      try {
        text = cleanKeyword(w.word);
      } catch {
        continue;
      }
      add("add_negative", `${cid}|phrase|${text}`, { campaignId: cid, campaign: "", text, match: "PHRASE", reason: `${w.terms} search terms containing "${w.word}" spent ${w.cost} with no conversion.`, cost: w.cost });
    }
  }
  for (const c of f.budgetLimited || []) {
    if (c.shared || !c.budgetResource || c.budget === null) continue; // a shared budget moves other campaigns too: that is a person's call
    let next = Math.round(c.budget * (1 + BUDGET_SUGGEST_STEP) * 100) / 100;
    if (maxDailyBudget !== null && next > maxDailyBudget) next = maxDailyBudget;
    if (next <= c.budget) continue;
    add("set_budget", c.budgetResource, { budgetResource: c.budgetResource, campaign: c.campaign, from: c.budget, to: next, reason: `Lost ${c.lostToBudget}% of impressions to budget while converting at ${c.cpa}.` });
  }
  for (const kw of f.lowQuality || []) {
    if (kw.conversions > 0) continue; // a low-score keyword that converts is a page or ad problem, not one to switch off
    add("pause_keyword", kw.resource, { resource: kw.resource, keyword: kw.keyword, adGroup: kw.adGroup, reason: `Quality Score ${kw.qualityScore}, ${kw.cost} spent, no conversion.`, cost: kw.cost });
  }
  return out;
}

/* ------------------------------------------------------------------ reading the current state */

async function readOne(client, cid, query) {
  const rows = await client.search(cid, query, { maxRows: 2 });
  return rows[0] || null;
}

export async function readNegative(client, cid, campaignId, text, match) {
  const r = await readOne(
    client,
    cid,
    `SELECT campaign_criterion.resource_name FROM campaign_criterion WHERE campaign.id = ${numericId(campaignId, "Campaign")} AND campaign_criterion.negative = TRUE AND campaign_criterion.type = 'KEYWORD' AND campaign_criterion.keyword.text = ${lit(text)} AND campaign_criterion.keyword.match_type = '${match}'`,
  );
  return r?.campaignCriterion?.resourceName || null;
}
export async function readKeywordStatus(client, cid, resource) {
  const r = await readOne(client, cid, `SELECT ad_group_criterion.status FROM ad_group_criterion WHERE ad_group_criterion.resource_name = ${lit(resource)}`);
  return r?.adGroupCriterion?.status || null;
}
export async function readBudget(client, cid, resource) {
  const r = await readOne(client, cid, `SELECT campaign_budget.amount_micros, campaign_budget.explicitly_shared FROM campaign_budget WHERE campaign_budget.resource_name = ${lit(resource)}`);
  if (!r?.campaignBudget) return null;
  return { amount: fromMicros(r.campaignBudget.amountMicros), shared: !!r.campaignBudget.explicitlyShared };
}
export async function readAdStatus(client, cid, resource) {
  const r = await readOne(client, cid, `SELECT ad_group_ad.status FROM ad_group_ad WHERE ad_group_ad.resource_name = ${lit(resource)}`);
  return r?.adGroupAd?.status || null;
}

/* ------------------------------------------------------------------ the write, then the check */

/** Send validateOnly first; only a clean validation is followed by the real write. Returns the resource names Google reports. */
async function write(client, cid, service, operations) {
  await client.mutate(cid, service, operations, { validateOnly: true });
  return client.mutate(cid, service, operations);
}

/** Budget limits, enforced for every caller including undo's own replay. */
export function checkBudgetMove(from, to, { maxDailyBudget = null } = {}) {
  if (!(to > 0)) throw new Error("A budget must be more than zero.");
  if (from > 0 && Math.abs(to - from) / from > BUDGET_MAX_STEP + 1e-9) {
    throw new Error(`AdsPilot moves a budget by at most ${Math.round(BUDGET_MAX_STEP * 100)}% in one change (from ${from} that is ${Math.round(from * (1 - BUDGET_MAX_STEP) * 100) / 100} to ${Math.round(from * (1 + BUDGET_MAX_STEP) * 100) / 100}). Bigger moves are made in steps, or in Google Ads.`);
  }
  if (maxDailyBudget !== null && to > maxDailyBudget && to > from) throw new Error(`That is above this account's daily budget ceiling of ${maxDailyBudget}, set in Ads → Settings.`);
}

/**
 * Apply one approved proposal. Returns a journal entry; throws (and changes nothing) when a precondition fails.
 * `connection` is the project's gads connection; `limits` carries the project's ceiling.
 */
export async function apply({ client, customerId, connection, proposal, limits = {}, by = "" }) {
  assertWritable(connection);
  const cid = cleanCid(customerId);
  const base = { id: `j_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, proposal_id: proposal.id || "", kind: proposal.kind, applied_at: new Date().toISOString(), applied_by: by, undone_at: null };

  if (proposal.kind === "add_negative") {
    const text = cleanKeyword(proposal.text);
    const match = proposal.match === "PHRASE" ? "PHRASE" : "EXACT";
    const campaignId = numericId(proposal.campaignId, "Campaign");
    if (await readNegative(client, cid, campaignId, text, match)) throw new Error(`"${text}" is already a negative keyword on that campaign.`);
    const [resource] = await write(client, cid, "campaignCriteria", [{ create: { campaign: `customers/${cid}/campaigns/${campaignId}`, negative: true, keyword: { text, matchType: match } } }]);
    const landed = await readNegative(client, cid, campaignId, text, match);
    return { ...base, target: { campaignId, text, match }, before: null, after: { resource: landed || resource || "" }, verified: !!landed, summary: `Added "${text}" (${match.toLowerCase()}) as a negative keyword.` };
  }

  if (proposal.kind === "pause_keyword") {
    const resource = checkResource("adGroupCriteria", proposal.resource, cid);
    const before = await readKeywordStatus(client, cid, resource);
    if (before === null) throw new Error("That keyword could not be read from Google Ads, so it was not changed.");
    if (before !== "ENABLED") throw new Error(`That keyword is ${before.toLowerCase()} already, so it was not changed.`);
    await write(client, cid, "adGroupCriteria", [{ update: { resourceName: resource, status: "PAUSED" }, updateMask: "status" }]);
    const after = await readKeywordStatus(client, cid, resource);
    return { ...base, target: { resource, keyword: proposal.keyword || "" }, before: { status: before }, after: { status: after }, verified: after === "PAUSED", summary: `Paused the keyword "${proposal.keyword || resource}".` };
  }

  if (proposal.kind === "set_budget") {
    const resource = checkResource("campaignBudgets", proposal.budgetResource, cid);
    const cur = await readBudget(client, cid, resource);
    if (!cur) throw new Error("That budget could not be read from Google Ads, so it was not changed.");
    if (cur.shared) throw new Error("That budget is shared with other campaigns. Change it in Google Ads, where you can see all of them.");
    if (proposal.from !== undefined && Math.abs(cur.amount - Number(proposal.from)) > 0.005) {
      throw new Error(`The budget is ${cur.amount} now, not the ${proposal.from} this suggestion was made from. Sync again for a fresh suggestion.`);
    }
    const to = Math.round(Number(proposal.to) * 100) / 100;
    checkBudgetMove(cur.amount, to, limits);
    await write(client, cid, "campaignBudgets", [{ update: { resourceName: resource, amountMicros: String(toMicros(to)) }, updateMask: "amount_micros" }]);
    const after = await readBudget(client, cid, resource);
    return { ...base, target: { resource, campaign: proposal.campaign || "" }, before: { amount: cur.amount }, after: { amount: after?.amount ?? null }, verified: !!after && Math.abs(after.amount - to) < 0.005, summary: `Changed the daily budget of ${proposal.campaign || "a campaign"} from ${cur.amount} to ${to}.` };
  }

  if (proposal.kind === "create_paused_ad") {
    const adGroupId = numericId(proposal.adGroupId, "Ad group");
    const ad = RSA.validate(proposal);
    const [resource] = await write(client, cid, "adGroupAds", [
      {
        create: {
          adGroup: `customers/${cid}/adGroups/${adGroupId}`,
          status: "PAUSED",
          ad: {
            finalUrls: [ad.finalUrl],
            responsiveSearchAd: { headlines: ad.headlines.map((text) => ({ text })), descriptions: ad.descriptions.map((text) => ({ text })), ...(ad.path1 ? { path1: ad.path1 } : {}), ...(ad.path2 ? { path2: ad.path2 } : {}) },
          },
        },
      },
    ]);
    const status = resource && RESOURCE.adGroupAds.test(resource) ? await readAdStatus(client, cid, resource) : null;
    return { ...base, target: { adGroupId, resource: resource || "" }, before: null, after: { status }, verified: status === "PAUSED", summary: `Created a new ad in ad group ${adGroupId}, paused. Switch it on in Google Ads when you are happy with it.` };
  }

  throw new Error(`AdsPilot does not know how to make a "${proposal.kind}" change.`);
}

/**
 * Undo one journal entry. Refuses when the entity is no longer in the state AdsPilot left it in: somebody changed it since, and putting
 * the old value back would silently overwrite their change.
 */
export async function undo({ client, customerId, connection, entry, limits = {} }) {
  assertWritable(connection);
  if (entry.undone_at) throw new Error("That change was already undone.");
  const cid = cleanCid(customerId);

  if (entry.kind === "add_negative") {
    const now = await readNegative(client, cid, entry.target.campaignId, entry.target.text, entry.target.match);
    if (!now) throw new Error("That negative keyword is not on the campaign any more, so there is nothing to undo.");
    checkResource("campaignCriteria", now, cid);
    await write(client, cid, "campaignCriteria", [{ remove: now }]);
    const gone = !(await readNegative(client, cid, entry.target.campaignId, entry.target.text, entry.target.match));
    return { verified: gone, summary: `Removed the negative keyword "${entry.target.text}".` };
  }
  if (entry.kind === "pause_keyword") {
    const resource = checkResource("adGroupCriteria", entry.target.resource, cid);
    const now = await readKeywordStatus(client, cid, resource);
    if (now !== entry.after.status) throw new Error(`The keyword is ${String(now || "unreadable").toLowerCase()} now, not paused as AdsPilot left it. Somebody changed it since; undo would overwrite that.`);
    await write(client, cid, "adGroupCriteria", [{ update: { resourceName: resource, status: entry.before.status }, updateMask: "status" }]);
    const back = await readKeywordStatus(client, cid, resource);
    return { verified: back === entry.before.status, summary: `Set the keyword back to ${entry.before.status.toLowerCase()}.` };
  }
  if (entry.kind === "set_budget") {
    const resource = checkResource("campaignBudgets", entry.target.resource, cid);
    const now = await readBudget(client, cid, resource);
    if (!now || entry.after.amount === null || Math.abs(now.amount - entry.after.amount) > 0.005) throw new Error(`The budget is ${now?.amount ?? "unreadable"} now, not the ${entry.after.amount} AdsPilot set. Somebody changed it since; undo would overwrite that.`);
    // No step check on the way back: it restores a value the account already had, and from a lowered budget the way back is a bigger
    // percentage than the way down (70 → 100 is +43% after 100 → 70 was −30%), so a step check here would make undo impossible.
    if (!(entry.before.amount > 0)) throw new Error("The budget before the change was not recorded, so it cannot be put back.");
    await write(client, cid, "campaignBudgets", [{ update: { resourceName: resource, amountMicros: String(toMicros(entry.before.amount)) }, updateMask: "amount_micros" }]);
    const back = await readBudget(client, cid, resource);
    return { verified: !!back && Math.abs(back.amount - entry.before.amount) < 0.005, summary: `Set the daily budget back to ${entry.before.amount}.` };
  }
  if (entry.kind === "create_paused_ad") {
    const resource = checkResource("adGroupAds", entry.target.resource, cid);
    const now = await readAdStatus(client, cid, resource);
    if (now !== "PAUSED") throw new Error(`The ad is ${String(now || "unreadable").toLowerCase()} now, not paused as AdsPilot created it. Somebody switched it on; remove it in Google Ads if you mean to.`);
    await write(client, cid, "adGroupAds", [{ remove: resource }]);
    const after = await readAdStatus(client, cid, resource);
    return { verified: after === null || after === "REMOVED", summary: "Removed the paused ad AdsPilot created." };
  }
  throw new Error(`Cannot undo a "${entry.kind}" change.`);
}
