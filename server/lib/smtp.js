// lib/smtp.js — send one plain-text email through a mailbox the agency owns.
//
// Plain text on purpose: an outreach note from a person is plain text, and a styled template is the
// first thing a spam filter learns. Every message carries a List-Unsubscribe header pointing back at the
// sending mailbox, so a recipient's mail client can offer "unsubscribe" and the reply lands where the
// agency can see it.
//
// AP_SMTP_SINK=1 builds the message and sends nothing (nodemailer's JSON transport); the end-to-end test
// uses it so no test ever reaches a real mail server. A password of "bad-password" fails the way a wrong
// app password does, so the error path is testable too.

import nodemailer from "nodemailer";

const SINK = () => process.env.AP_SMTP_SINK === "1";

function transportFor(mb, password) {
  if (SINK()) return nodemailer.createTransport({ jsonTransport: true });
  return nodemailer.createTransport({
    host: mb.host,
    port: mb.port,
    secure: mb.port === 465,
    auth: { user: mb.email, pass: password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
}

/** The reason in words, and whether it is the mailbox's login that is wrong (which stops using it). */
export function explainSmtp(e) {
  const code = String(e?.code || "");
  const msg = String(e?.response || e?.message || e).slice(0, 200);
  if (code === "EAUTH" || /^53[45]\b/.test(String(e?.responseCode || "")) || /authentication|invalid login|username and password/i.test(msg)) return { auth: true, text: "The mailbox refused the login. Check the address and the app password (a normal account password usually does not work)." };
  if (code === "ECONNECTION" || code === "ETIMEDOUT" || code === "ESOCKET" || code === "EDNS") return { auth: false, transient: true, text: `Could not reach the mail server (${code}).` };
  return { auth: false, text: msg };
}

export async function verifyMailbox(mb, password) {
  if (SINK()) {
    if (password === "bad-password") throw Object.assign(new Error("Invalid login"), { code: "EAUTH" });
    return true;
  }
  await transportFor(mb, password).verify();
  return true;
}

export async function sendMail({ mailbox, password, to, subject, text, fromName = "" }) {
  if (SINK() && password === "bad-password") throw Object.assign(new Error("Invalid login"), { code: "EAUTH" });
  const info = await transportFor(mailbox, password).sendMail({
    from: fromName ? { name: fromName, address: mailbox.email } : mailbox.email,
    to,
    subject,
    text,
    headers: { "List-Unsubscribe": `<mailto:${mailbox.email}?subject=unsubscribe>` },
  });
  return { messageId: info.messageId || "" };
}
