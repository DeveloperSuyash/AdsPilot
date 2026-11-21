// lib/adsalerts.js — Google Ads incidents, from one sync. Pure: decides; the store keeps the log; deliverAlerts sends.
//
// Same rules as alerts.js: an alert is an EVENT with a moment it was raised, every threshold has a relative AND an absolute floor, and with no
// previous period nothing about change is said. Every type starts with "ads:" so `producerOf` maps them to the "ads" producer and only an
// ads sync (covers: ["ads"]) can raise or resolve them. A Search Console sync must never sweep an ads alert away, or the next ads sync raises
// it again as a fresh incident with a fresh email.

import { actionKey } from "./ids.js";
import { accountKpis, money } from "./adsanalyze.js";

export const SPEND_SPIKE_RATIO = 1.5; // +50%
export const CPA_JUMP_RATIO = 1.4; // +40%
export const MIN_CONV_FOR_CPA = 5; // a cost per conversion over fewer conversions moves too much on luck to alert on
export const ADS_PRODUCERS = ["ads"];
export const producerOf = (type) => (String(type || "").startsWith("ads:") ? "ads" : "other");

export function evaluate({ project, sync, findings }) {
  const out = [];
  const pid = project?.id || "";
  const cur = sync?.account?.currency || "";
  const push = (type, subject, severity, title, detail, evidence = {}) =>
    out.push({ id: actionKey(pid, `alert:${type}`, subject), project_id: pid, type, subject, severity, title, detail, evidence });

  if (findings?.tracking?.kind === "stopped") {
    push("ads:conversions-stopped", "account", "critical", "Google Ads conversions stopped", findings.tracking.detail, { cost: findings.tracking.cost, previous: findings.tracking.previousConversions });
  }

  if (sync?.hasPrevious) {
    const now = accountKpis(sync.totals);
    const before = accountKpis(sync.previous);
    // Spend: up by half AND by more than one previous conversion's worth (or a quarter of the old spend where there is no conversion cost),
    // so a ₹200 account going to ₹320 does not page anybody.
    const floor = before.cpa !== null ? before.cpa : before.cost * 0.25;
    if (before.cost > 0 && now.cost >= before.cost * SPEND_SPIKE_RATIO && now.cost - before.cost >= floor) {
      push("ads:spend-spike", "account", "serious", "Google Ads spend jumped", `${money(now.cost, cur)} against ${money(before.cost, cur)} the period before, with ${now.conversions} conversions against ${before.conversions}.`, { cost: now.cost, previous: before.cost });
    }
    if (now.cpa !== null && before.cpa !== null && now.conversions >= MIN_CONV_FOR_CPA && before.conversions >= MIN_CONV_FOR_CPA && now.cpa >= before.cpa * CPA_JUMP_RATIO) {
      push("ads:cpa-jump", "account", "serious", "Cost per conversion jumped", `${money(now.cpa, cur)} per conversion against ${money(before.cpa, cur)} the period before.`, { cpa: now.cpa, previous: before.cpa });
    }
  }

  if (findings?.disapproved?.length) {
    const n = findings.disapproved.length;
    push("ads:disapproved", "account", "serious", `${n} Google Ads ad${n === 1 ? " is" : "s are"} disapproved`, "Switched on but not being shown. The reasons are in Google Ads.", { count: n });
  }
  return out;
}
