// lib/mail.js — composing an email, and the one place one is actually sent.
//
// Split the same way as ai.js: the part that decides WHAT to send is pure and tested,
// and the part that hands it to a provider is a thin shim behind an engine name. That
// matters more here than elsewhere, because the failure mode is silent — an email that
// was never sent looks exactly like an email that was sent and ignored.
//
// Engines:
//
//   none  — the default, and the honest one when no credentials exist. Messages are
//           queued and recorded and NOT sent, and every screen that shows the outbox
//           says so. A queue that silently swallows mail is worse than no mail.
//   http  — a provider's REST API, over fetch. No new dependency, which is the same
//           reasoning that kept bcrypt out of auth.js.
//
// SMTP is deliberately absent for now: it needs a real client library, and an HTTP
// provider is what a new install will have anyway.

const ENGINE = () => (process.env.AP_MAIL_ENGINE || "none").toLowerCase();
const FROM = () => process.env.AP_MAIL_FROM || "";
const API_URL = () => process.env.AP_MAIL_API_URL || "https://api.resend.com/emails";
const API_KEY = () => process.env.AP_MAIL_API_KEY || "";

export const engineName = () => ENGINE();

/** True only when a message would actually leave the building. */
export function isConfigured() {
  if (ENGINE() !== "http") return false;
  return !!(API_KEY() && FROM());
}

/**
 * Why it is not configured, in words somebody can act on.
 *
 * "Email is not set up" sends a person hunting. Naming the missing variable does not.
 */
export function whyNotConfigured() {
  if (ENGINE() === "none") return "Email is switched off (AP_MAIL_ENGINE is not set). Reports can still be shared by link.";
  if (!API_KEY()) return "AP_MAIL_API_KEY is not set, so nothing can be sent.";
  if (!FROM()) return "AP_MAIL_FROM is not set — a provider will reject mail with no sender.";
  return "";
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * The email that carries a client report.
 *
 * It does NOT reproduce the report. A summary in the email and a report behind the link
 * are two documents that will disagree the moment one changes, and the client will
 * believe whichever arrived first. So the email says what it is, gives the headline
 * movement in one line, and links.
 *
 * Plain text is generated alongside, not as an afterthought: a mail client that cannot
 * render the HTML must still show a working link, and some corporate filters strip HTML
 * entirely before a business owner ever sees it.
 */
export function renderReportEmail({ report, url }) {
  const project = report?.project?.name || "your website";
  const agency = report?.agency || "Your SEO team";
  const period = report?.period ? `${report.period.start} to ${report.period.end}` : "";
  const clicks = (report?.headline || []).find((m) => m.key === "clicks");

  // One line, from the report's own words — never recomputed here, or the email and the
  // report become two sources for the same number.
  const line = clicks
    ? clicks.movement
      ? `Visits from Google were ${clicks.movement}${report.comparedWith ? ` compared with ${report.comparedWith}` : ""}.`
      : `Visits from Google: ${clicks.value}.`
    : "";

  const subject = `${project} — search performance${period ? ` (${period})` : ""}`;

  const text = [
    `Your search performance report for ${project} is ready.`,
    period ? `Period: ${period}` : "",
    line,
    "",
    `Read it here: ${url}`,
    "",
    `Prepared by ${agency} with AdsPilot.`,
  ]
    .filter(Boolean)
    .join("\n");

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1c1c">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">
<div style="font-size:12px;color:#6b6b6b">${esc(agency)}</div>
<h1 style="font-size:20px;margin:6px 0 4px">${esc(project)} — search performance</h1>
${period ? `<div style="font-size:13px;color:#6b6b6b">${esc(period)}</div>` : ""}
${line ? `<p style="font-size:15px;line-height:1.5;margin:18px 0">${esc(line)}</p>` : ""}
<p style="margin:22px 0"><a href="${esc(url)}" style="background:#4F46E5;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;display:inline-block;font-size:14px">Read the report</a></p>
<p style="font-size:12px;color:#8a8a8a;margin:18px 0 0;word-break:break-all">${esc(url)}</p>
<hr style="border:none;border-top:1px solid #eee;margin:22px 0">
<div style="font-size:12px;color:#8a8a8a">Prepared by ${esc(agency)} with AdsPilot.</div>
</div></body></html>`;

  return { subject, text, html };
}

/**
 * The email that carries an alert.
 *
 * Written for a phone on a Saturday, because that is when it will be read. The subject
 * carries the project name and the fact, not "AdsPilot Alert Notification" — a subject
 * line that says nothing forces the person to open it to find out whether it matters, and
 * they will stop opening it.
 *
 * Unlike the report email this DOES carry the substance. The reasoning that keeps a report
 * out of its email is that a summary and a report are two documents that disagree the
 * moment one changes — but an alert is not a living document. It is a fixed statement
 * about a moment, and its whole value is being read without opening anything.
 *
 * There is deliberately no "fix it" link into the app beyond the project page. Nothing here
 * can be fixed from an email, and a button that implies otherwise is a lie about what the
 * next click does.
 */
export function renderAlertEmail({ alert, project, url = "" }) {
  const name = project?.name || "a project";
  const severity = alert?.severity === "critical" ? "Critical" : "Needs a look";
  const subject = `${name}: ${alert?.title || "something changed"}`;

  const text = [
    `${severity} — ${name}`,
    "",
    alert?.title || "",
    alert?.detail || "",
    url ? "" : null,
    url ? `Open the project: ${url}` : null,
    "",
    "You are getting this because this address is on the alert list for this workspace.",
  ]
    .filter((l) => l !== null)
    .join("\n");

  const accent = alert?.severity === "critical" ? "#DC2626" : "#D97706";
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1c1c">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;border-top:3px solid ${accent}">
<div style="font-size:12px;color:${accent};font-weight:600;text-transform:uppercase;letter-spacing:.04em">${esc(severity)}</div>
<h1 style="font-size:19px;margin:8px 0 4px;line-height:1.35">${esc(alert?.title || "")}</h1>
<div style="font-size:13px;color:#6b6b6b">${esc(name)}</div>
<p style="font-size:15px;line-height:1.55;margin:18px 0">${esc(alert?.detail || "")}</p>
${url ? `<p style="margin:22px 0"><a href="${esc(url)}" style="background:#4F46E5;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;display:inline-block;font-size:14px">Open the project</a></p>` : ""}
<hr style="border:none;border-top:1px solid #eee;margin:22px 0">
<div style="font-size:12px;color:#8a8a8a">You are getting this because this address is on the alert list for this workspace.</div>
</div></body></html>`;

  return { subject, text, html };
}

/**
 * The "confirm your address" email for a beta request.
 *
 * Plain text carries the same link — a corporate filter that strips the HTML must still
 * leave a working one. The link is built from AP_APP_URL by the caller, never from a
 * request header.
 */
export function renderVerifyEmail({ name, url, hours = 24 }) {
  const subject = "Confirm your email — AdsPilot beta";
  const text = [
    `Hi ${name || "there"},`,
    "",
    "Thanks for requesting beta access to AdsPilot. Confirm this address to finish:",
    url,
    "",
    `The link works for ${hours} hours. If you did not ask for this, ignore this email.`,
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1c1c">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">
<h1 style="font-size:20px;margin:0 0 8px">Confirm your email</h1>
<p style="font-size:15px;line-height:1.55;margin:12px 0">Hi ${esc(name || "there")}, thanks for requesting beta access to AdsPilot. Confirm this address to finish.</p>
<p style="margin:22px 0"><a href="${esc(url)}" style="background:#4F46E5;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;display:inline-block;font-size:14px">Confirm email</a></p>
<p style="font-size:12px;color:#8a8a8a;margin:18px 0 0;word-break:break-all">${esc(url)}</p>
<hr style="border:none;border-top:1px solid #eee;margin:22px 0">
<div style="font-size:12px;color:#8a8a8a">The link works for ${hours} hours. If you did not ask for this, ignore this email.</div>
</div></body></html>`;
  return { subject, text, html };
}

/** Obviously-wrong addresses, rejected before they become a bounce and a failed row. */
const EMAIL_RE = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;
export const validRecipients = (list) =>
  [...new Set((Array.isArray(list) ? list : String(list || "").split(/[,\s]+/)).map((e) => String(e).trim().toLowerCase()))]
    .filter((e) => EMAIL_RE.test(e))
    .slice(0, 20);

/**
 * Hand one message to the provider.
 *
 * Throws on failure so the caller records it. `sendImpl` is injectable for the same
 * reason as everywhere else here: the tests must not need an account.
 */
export async function send({ to, subject, text, html }, sendImpl = null) {
  if (sendImpl) return sendImpl({ to, subject, text, html });
  if (!isConfigured()) throw new Error(whyNotConfigured() || "Email is not configured.");
  const res = await fetch(API_URL(), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY()}` },
    body: JSON.stringify({ from: FROM(), to, subject, text, html }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message || body?.error?.message || `The mail provider answered ${res.status}.`);
  return { id: body?.id || "" };
}
