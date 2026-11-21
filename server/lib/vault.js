// lib/vault.js — the one place a stored secret becomes ciphertext.
//
// AdsPilot holds a Google refresh token. That token is a standing key to somebody's
// Search Console data, it does not expire on its own, and db.json travels: it gets
// backed up, synced, zipped, pasted into a bug report. So it never sits in there in
// the clear.
//
// AES-256-GCM — authenticated, so a tampered blob fails to decrypt instead of quietly
// handing back garbage that then gets sent to Google as a credential.
//
// About the key, honestly:
//   · AP_MASTER_KEY set   — the key lives outside the database, so a leaked db.json is
//     genuinely useless on its own. This is the setup worth having.
//   · AP_MASTER_KEY unset — a key is generated once and kept in a file beside the
//     database. That still protects the database in transit, but NOT someone who
//     already has this disk. It is the honest default; refusing to boot would just
//     push the token back into a plain .env file.

import crypto from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.AP_DATA_DIR || join(__dirname, "..", "data");
const KEY_PATH = join(DATA_DIR, "vault.key");

const PREFIX = "v1"; // so a future scheme can be told apart without guessing

let KEY = null;
let KEY_SOURCE = "";

/** 32 bytes, from the environment if we're given them, otherwise from a local file. */
function key() {
  if (KEY) return KEY;
  const env = String(process.env.AP_MASTER_KEY || "").trim();
  if (env) {
    // 64 hex chars is a real key, pasted. Anything else is a passphrase somebody
    // typed, and gets stretched — a short passphrase used raw would be a 6-byte key.
    KEY = /^[0-9a-f]{64}$/i.test(env)
      ? Buffer.from(env, "hex")
      : crypto.scryptSync(env, "seopilot-vault-v1", 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    KEY_SOURCE = "env";
    return KEY;
  }
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (existsSync(KEY_PATH)) {
    KEY = Buffer.from(readFileSync(KEY_PATH, "utf8").trim(), "hex");
  } else {
    KEY = crypto.randomBytes(32);
    writeFileSync(KEY_PATH, KEY.toString("hex"), "utf8");
    try {
      chmodSync(KEY_PATH, 0o600); // no-op on most Windows setups; free where it works
    } catch {
      /* best effort */
    }
  }
  KEY_SOURCE = "file";
  return KEY;
}

/** Where the key came from — surfaced in Settings so nobody has to guess. */
export function keySource() {
  key();
  return KEY_SOURCE;
}

/** "v1:<iv>:<tag>:<ciphertext>", all base64url. Empty in, empty out. */
export function encrypt(plain) {
  const s = String(plain ?? "");
  if (!s) return "";
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(s, "utf8"), c.final()]);
  return [PREFIX, iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(":");
}

/**
 * Back to plaintext. Returns "" when it cannot — wrong key, truncated blob, tampered
 * tag. Never throws: a connection with one unreadable field should still be listable
 * and re-connectable in the UI, not a page that refuses to render.
 */
export function decrypt(blob) {
  const s = String(blob ?? "");
  if (!s) return "";
  const parts = s.split(":");
  if (parts.length !== 4 || parts[0] !== PREFIX) return "";
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(parts[1], "base64url"));
    d.setAuthTag(Buffer.from(parts[2], "base64url"));
    return Buffer.concat([d.update(Buffer.from(parts[3], "base64url")), d.final()]).toString("utf8");
  } catch {
    return "";
  }
}

export function isEncrypted(v) {
  return typeof v === "string" && v.startsWith(PREFIX + ":") && v.split(":").length === 4;
}

/** Encrypt only if it isn't already — so a re-save doesn't double-wrap. */
export function seal(v) {
  const s = String(v ?? "");
  if (!s) return "";
  return isEncrypted(s) ? s : encrypt(s);
}

/** Decrypt if it looks sealed, otherwise hand back what's there. */
export function open(v) {
  const s = String(v ?? "");
  if (!s) return "";
  return isEncrypted(s) ? decrypt(s) : s;
}
