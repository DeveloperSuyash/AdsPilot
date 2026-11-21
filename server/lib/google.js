// lib/google.js — Google sign-in for AdsPilot: the consent URL, the code exchange, the refresh, and who signed in. Adapted from SEOPilot's,
// with one scope only.
//
// The `adwords` scope reads AND writes; Google has no read-only variant. So the consent screen always says "manage your AdWords campaigns",
// whatever AdsPilot will do, and the read-only promise is kept by our own switch (lib/adschange.js `assertWritable`), not by Google.

import { SCOPE } from "./gads.js";

const OAUTH_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN = "https://oauth2.googleapis.com/token";
const USERINFO = "https://www.googleapis.com/oauth2/v2/userinfo";

export const ADS_REFUSED = "Google Ads access wasn't granted. On Google's screen there is a tick box for your Google Ads campaigns — it has to be ticked, or nothing can be read. Try again.";

export const isConfigured = (cfg) => !!(cfg?.clientId && cfg?.clientSecret);

/** Built one way, so the URI registered in Google Cloud and the one sent can never drift apart. */
export const redirectUri = (appUrl) => `${String(appUrl || "").replace(/\/+$/, "")}/oauth/google/callback`;

/** Did the grant that came back include Ads? Google returns a working token with a box unticked, so this is checked when it arrives. */
export const grantedAds = (scope) => String(scope || "").split(/\s+/).includes(SCOPE);

export function authUrl({ clientId, appUrl, state }) {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(appUrl),
    response_type: "code",
    scope: `${SCOPE} https://www.googleapis.com/auth/userinfo.email`,
    // Offline + consent together: Google returns a refresh token only on a first consent, and a reconnect without one dies in an hour.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: String(state || ""),
  });
  return `${OAUTH_AUTH}?${p.toString()}`;
}

function explain(status, body, what) {
  const msg = body?.error?.message || body?.error_description || body?.error || "";
  if (status === 401) return `Google rejected the credentials (${what}). Connect Google Ads again.`;
  if (status === 429) return `Google is rate-limiting this account (${what}). Wait a few minutes and try again.`;
  return `Google returned ${status} for ${what}${msg ? `: ${msg}` : ""}.`;
}
async function jsonOrThrow(res, what) {
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* an HTML error page or an empty body */
  }
  if (!res.ok) throw new Error(explain(res.status, body, what));
  return body ?? {};
}

export async function exchangeCode({ code, clientId, clientSecret, appUrl }, requestImpl = fetch) {
  const res = await requestImpl(OAUTH_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code: String(code || ""), client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri(appUrl), grant_type: "authorization_code" }).toString(),
  });
  const body = await jsonOrThrow(res, "the sign-in exchange");
  if (!body.refresh_token) return { ...body, refresh_token: "", warning: "Google didn't return a refresh token. Remove AdsPilot from your Google account permissions and connect again." };
  return body;
}

export async function refreshAccess({ refreshToken, clientId, clientSecret }, requestImpl = fetch) {
  const res = await requestImpl(OAUTH_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: String(refreshToken || ""), client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token" }).toString(),
  });
  return jsonOrThrow(res, "renewing the Google session");
}

export async function userInfo(accessToken, requestImpl = fetch) {
  const res = await requestImpl(USERINFO, { headers: { authorization: `Bearer ${accessToken}` } });
  return jsonOrThrow(res, "reading the Google account");
}
