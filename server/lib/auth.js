// lib/auth.js — passwords and sessions, with no dependencies.
//
// Same reasoning as DevPilot's: bcrypt and argon2 are native modules, and a native
// module that won't build on a Windows laptop at 1am is a worse outcome than the
// marginal difference between them and scrypt. Node ships scrypt in core.
//
// Two rules the rest of the server relies on:
//   · a session TOKEN is only ever seen by the browser. What is stored is its
//     SHA-256, so a leaked database does not hand anyone a working login.
//   · every comparison of a secret is timing-safe — not because someone is going to
//     time this laptop, but because the day it is on the internet nobody will
//     remember to come back and fix it.

import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);

const KEYLEN = 64;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Hash a password for storage. Returns "scrypt$<salt-hex>$<hash-hex>". */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password), salt, KEYLEN, SCRYPT);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

/** Check a password against a stored hash. Never throws — a bad record is just false. */
export async function verifyPassword(password, stored) {
  try {
    const [scheme, saltHex, keyHex] = String(stored || "").split("$");
    if (scheme !== "scrypt" || !saltHex || !keyHex) return false;
    const key = await scrypt(String(password), Buffer.from(saltHex, "hex"), KEYLEN, SCRYPT);
    const want = Buffer.from(keyHex, "hex");
    return key.length === want.length && crypto.timingSafeEqual(key, want);
  } catch {
    return false;
  }
}

/** A new session token. The caller gives the raw one to the browser, stores the hash. */
export function newSessionToken() {
  const token = crypto.randomBytes(32).toString("hex");
  return { token, hash: hashToken(token) };
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

/** Constant-time string compare that tolerates different lengths. */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ""));
  const y = Buffer.from(String(b ?? ""));
  if (x.length !== y.length) {
    // Still do the work, so length isn't leaked by timing alone.
    crypto.timingSafeEqual(x, x);
    return false;
  }
  return crypto.timingSafeEqual(x, y);
}

/** Normalise an email for storage and comparison. */
export function normEmail(e) {
  return String(e || "").trim().toLowerCase();
}

const EMAIL_RE = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

/** Reject the obviously-wrong before it reaches the store. Returns null or a reason. */
export function validateSignup({ email, password, name }) {
  if (!EMAIL_RE.test(normEmail(email))) return "That doesn't look like an email address.";
  if (String(password || "").length < 10) return "Use at least 10 characters — this login can reach your clients' ad accounts.";
  if (String(name || "").trim().length < 1) return "What should we call you?";
  return null;
}
