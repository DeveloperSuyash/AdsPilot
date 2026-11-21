// lib/gads.js — the Google Ads API, over plain REST. AdsPilot's only door into an ad account.
//
// Written from the REST reference as remembered on 2026-11-20: developers.google.com was not reachable from the session that wrote it,
// so NOTHING here has been run against the real API yet. Every call goes through an injected `requestImpl`, the tests drive it with
// fakes, and the version is a setting (`AP_GADS_API_VERSION` or Administration → Google Ads) because Google retires a version about a
// year after it ships and a hard-coded one is a product that stops working on a date nobody wrote down.
//
// Three things about this API that are easy to get wrong:
//   · There is NO read-only scope. `adwords` reads and writes. So "read-only until you allow changes" cannot be a Google consent
//     boundary the way it is for Search Console or Tag Manager: it is a flag on OUR connection row, checked by OUR code before every
//     write (see lib/adschange.js `assertWritable`). Nothing on Google's side stops a write.
//   · Every call needs the install's developer token in a header, and a manager (MCC) login needs `login-customer-id` too, as digits.
//   · Money is in MICROS (1,000,000 = one unit of the account's currency). It is converted at the edge (`fromMicros`) and never
//     shown or stored as micros anywhere a person reads it.

export const DEFAULT_VERSION = "v22";
export const SCOPE = "https://www.googleapis.com/auth/adwords";
// Overridable only from the environment, for the route tests' local fake. Never from a request or a setting a customer can reach.
const BASE = () => (process.env.AP_GADS_BASE || "https://googleads.googleapis.com").replace(/\/+$/, "");

/** "123-456-7890" or "customers/1234567890" → "1234567890". Anything that is not 10 digits afterwards is refused. */
export function cleanCid(raw) {
  const digits = String(raw || "").replace(/^customers\//, "").replace(/-/g, "").trim();
  if (!/^\d{10}$/.test(digits)) throw new Error(`"${raw}" is not a Google Ads customer ID (ten digits, like 123-456-7890).`);
  return digits;
}

/** 1234567890 → "123-456-7890", the way Google Ads shows it. */
export const prettyCid = (cid) => String(cid || "").replace(/^(\d{3})(\d{3})(\d{4})$/, "$1-$2-$3");

/** Micros → currency units, rounded to 2 decimals. null stays null: "not reported" is not zero. */
export function fromMicros(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n / 10_000) / 100 : null;
}
export const toMicros = (units) => Math.round(Number(units) * 1_000_000);

/**
 * What an account is pointed at, stored as the connection's `property`: "cid" for a directly accessible account, "mgr:cid" when it is
 * reached through a manager account. One string, so the generic "pick one of the properties on that account" check works unchanged.
 */
export function parseProperty(property) {
  const s = String(property || "");
  const [a, b] = s.includes(":") ? s.split(":") : ["", s];
  return { loginCustomerId: a ? cleanCid(a) : "", customerId: cleanCid(b) };
}

/** Google's error body → one sentence a person can act on. The GoogleAdsFailure detail carries the real reason; the top message rarely does. */
export function explainError(status, body) {
  const err = body?.error || {};
  const failure = (err.details || []).find((d) => String(d?.["@type"] || "").includes("GoogleAdsFailure"));
  const first = failure?.errors?.[0];
  const code = first?.errorCode ? Object.entries(first.errorCode)[0] : null;
  const codeText = code ? `${code[0]}: ${code[1]}` : "";
  const msg = first?.message || err.message || `HTTP ${status}`;
  if (codeText.includes("DEVELOPER_TOKEN_NOT_APPROVED") || /developer token.*(test|not approved)/i.test(msg)) {
    return "Google Ads refused the developer token for this account: it is only approved for test accounts. Apply for Basic access in the Google Ads API Center, or use a test account.";
  }
  if (codeText.includes("DEVELOPER_TOKEN") || /developer.token/i.test(msg)) return `Google Ads did not accept the install's developer token (${msg}). The platform admin sets it under Admin → Google Ads.`;
  if (codeText.includes("USER_PERMISSION_DENIED") || /login-customer-id|permission/i.test(msg)) {
    return `The signed-in Google account cannot reach that Google Ads account (${msg}). If it is managed through a manager (MCC) account, pick it from the list under that manager.`;
  }
  if (status === 401) return "The Google sign-in for Google Ads has expired or been revoked. Connect Google Ads again.";
  return codeText ? `Google Ads: ${msg} (${codeText})` : `Google Ads: ${msg}`;
}

/**
 * A client bound to one token and developer token. `requestImpl` is fetch-shaped.
 * `loginCustomerId` is sent only when set (a manager in the path), never guessed.
 */
export function client({ accessToken, developerToken, loginCustomerId = "", version = DEFAULT_VERSION }, requestImpl = fetch) {
  if (!developerToken) throw new Error("No Google Ads developer token is set for this install. The platform admin adds it under Admin → Google Ads.");
  if (!accessToken) throw new Error("No Google Ads sign-in for this project. Connect Google Ads first.");
  const headers = () => {
    const h = { authorization: `Bearer ${accessToken}`, "developer-token": developerToken, "content-type": "application/json" };
    if (loginCustomerId) h["login-customer-id"] = cleanCid(loginCustomerId);
    return h;
  };
  async function call(method, path, body) {
    const res = await requestImpl(`${BASE()}/${version}/${path}`, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = null;
    }
    if (!res.ok) throw new Error(explainError(res.status, json));
    if (json === null) throw new Error("Google Ads answered with something that is not JSON.");
    return json;
  }

  return {
    /** customers:listAccessibleCustomers → ["1234567890", …]. Works with no login-customer-id. */
    async accessibleCustomers() {
      const r = await call("GET", "customers:listAccessibleCustomers");
      return (r.resourceNames || []).map((n) => cleanCid(n));
    },

    /**
     * GAQL search, every page. `maxRows` is a ceiling so an account with a million search terms cannot fill memory: the query itself
     * should already ORDER BY and LIMIT, this is the backstop. Returns raw rows (camelCase, as the REST API sends them).
     */
    async search(customerId, query, { maxRows = 20_000 } = {}) {
      const cid = cleanCid(customerId);
      const rows = [];
      let pageToken = "";
      for (let guard = 0; guard < 50; guard++) {
        const r = await call("POST", `customers/${cid}/googleAds:search`, pageToken ? { query, pageToken } : { query });
        rows.push(...(r.results || []));
        pageToken = r.nextPageToken || "";
        if (!pageToken || rows.length >= maxRows) break;
      }
      return rows.slice(0, maxRows);
    },

    /**
     * One mutate call. `service` is the REST collection ("campaignBudgets", "adGroupCriteria", "campaignCriteria", "adGroupAds").
     * `validateOnly` asks Google to check the operation without making it — used before every real write, so a change that would be
     * refused is refused before anything is recorded as attempted.
     */
    async mutate(customerId, service, operations, { validateOnly = false } = {}) {
      const cid = cleanCid(customerId);
      const r = await call("POST", `customers/${cid}/${service}:mutate`, { operations, partialFailure: false, validateOnly });
      return (r.results || []).map((x) => x.resourceName || "");
    },
  };
}

/**
 * Every account the signed-in Google user can work on, for the account picker.
 * A manager account is listed AND its client accounts are listed under it ("mgr:cid"), because the usual agency setup is one MCC with
 * every client underneath. Accounts whose details cannot be read are still listed, by number, with the reason — never silently dropped.
 */
export async function listAccounts({ accessToken, developerToken, version }, requestImpl = fetch) {
  const top = client({ accessToken, developerToken, version }, requestImpl);
  const ids = await top.accessibleCustomers();
  const out = [];
  const seen = new Set();
  const add = (row) => {
    if (seen.has(row.property)) return;
    seen.add(row.property);
    out.push(row);
  };
  for (const cid of ids.slice(0, 50)) {
    let info = null;
    try {
      const c = client({ accessToken, developerToken, version, loginCustomerId: cid }, requestImpl);
      const rows = await c.search(cid, "SELECT customer.id, customer.descriptive_name, customer.manager, customer.currency_code, customer.test_account FROM customer LIMIT 1");
      info = rows[0]?.customer || null;
      if (info?.manager) {
        add({ property: cid, name: `${info.descriptiveName || prettyCid(cid)} (manager)`, manager: true, currency: info.currencyCode || "" });
        const kids = await c.search(
          cid,
          "SELECT customer_client.client_customer, customer_client.descriptive_name, customer_client.manager, customer_client.level, customer_client.currency_code, customer_client.status FROM customer_client WHERE customer_client.level <= 1",
          { maxRows: 500 },
        );
        for (const k of kids) {
          const cc = k.customerClient || {};
          if (cc.manager || String(cc.level) === "0") continue;
          if (cc.status && cc.status !== "ENABLED") continue;
          const kid = cleanCid(cc.clientCustomer);
          add({ property: `${cid}:${kid}`, name: `${cc.descriptiveName || prettyCid(kid)} — via ${info.descriptiveName || prettyCid(cid)}`, manager: false, currency: cc.currencyCode || "" });
        }
        continue;
      }
      add({ property: cid, name: `${info?.descriptiveName || prettyCid(cid)}${info?.testAccount ? " (test account)" : ""}`, manager: false, currency: info?.currencyCode || "" });
    } catch (e) {
      add({ property: cid, name: `${prettyCid(cid)} — details could not be read`, manager: false, currency: "", error: e.message });
    }
  }
  // A manager cannot be synced as if it were an ad account: it has no campaigns of its own.
  return out.filter((x) => !x.manager);
}
