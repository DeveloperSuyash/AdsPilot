// lib/cost.js — what an analyst call actually costs, in USD.
//
// Ported from DevPilot's lib/pricing.js on 2026-09-07 — same Anthropic price list, since
// it is the same models regardless of which product is asking. Trimmed to what AdsPilot
// actually needs: the CLI engine's `total_cost_usd` already IS the dollar figure (Claude
// Code prices its own cache reads/writes internally), so this file's `costOf` only has
// to price the API engine's raw token counts. DevPilot's cache-write-vs-caching-saved
// comparison (`cacheEffectOf`) is not ported — that answers "is caching worth it", which
// is a question about how the CLI is being used, not about what AdsPilot spent.
//
// Pure: numbers in, numbers out. No store, no network, no settings.

const SONNET_5_INTRO_ENDS = Date.parse("2026-09-01T00:00:00Z");

export const RATES = {
  "claude-opus-5": { in: 5, out: 25 },
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-opus-4-7": { in: 5, out: 25 },
  "claude-sonnet-5": { in: 3, out: 15, introIn: 2, introOut: 10, introUntil: SONNET_5_INTRO_ENDS },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
};

const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25; // 5-minute — the API engine's own cache TTL
const CACHE_WRITE_1H_MULTIPLIER = 2;

/**
 * The rate card for one model, or null if we have never been told its price.
 *
 * null is load-bearing — a model missing from the table must NOT be costed at zero,
 * because that reads as "that was free" and this whole file exists so spend can never
 * be under-reported. Only a trailing 8-digit release date is stripped from the id
 * before the second lookup, same reason as DevPilot's own version: `claude-opus-4-8`
 * and `claude-sonnet-4-6` are different models, not one model wearing two names.
 */
export function rateFor(model, at = Date.now()) {
  const key = String(model || "");
  const r = RATES[key] || RATES[key.replace(/-\d{8}$/, "")];
  if (!r) return null;
  const intro = r.introUntil && at < r.introUntil;
  return { in: intro ? r.introIn : r.in, out: intro ? r.introOut : r.out, intro: !!intro };
}

/**
 * One call's token usage, priced. `usage` is the shape the Anthropic Messages API
 * returns: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`,
 * `cache_read_input_tokens`. Returns `{ usd, unknown }` — `unknown: true` on a model
 * with no rate means the tokens were real and spent, just not priceable here.
 */
export function costOf(model, usage = {}, at = Date.now()) {
  const r = rateFor(model, at);
  if (!r) return { usd: 0, unknown: true };
  const usd =
    ((Number(usage.input_tokens) || 0) * r.in +
      (Number(usage.output_tokens) || 0) * r.out +
      (Number(usage.cache_read_input_tokens) || 0) * r.in * CACHE_READ_MULTIPLIER +
      (Number(usage.cache_creation_input_tokens) || 0) * r.in * CACHE_WRITE_MULTIPLIER) /
    1e6;
  return { usd, unknown: false };
}

/** USD -> INR. An env var because it moves and a deploy should not be what changes it. */
export function usdToInr() {
  const n = Number(process.env.AP_USD_INR);
  return Number.isFinite(n) && n > 0 ? n : 98; // the owner's rate for converting dollar costs; AP_USD_INR overrides it
}
