// lib/engines.js — the extra AI engines (Codex, Gemini) and the failover between engines.
//
// AdsPilot's model calls are all one-shot: a system prompt and a question in, text out, no tools, no
// session. That is the one shape every engine here can serve, so a failover between them is safe in a
// way it is not for DevPilot's tool-using runs. Ported from DevPilot's codex.js and antigravity.js, cut
// down to that one shape — the MCP bridge, resume and the apply pipeline are DevPilot's and do not apply.
//
// Pure where it can be (`parseCodexRun`, `parseGeminiEnvelope`, `chainFor`, `orderByHealth` are text in,
// decisions out); `runCodex` / `runGemini` spawn a CLI and take an injectable `spawnImpl`, the way
// ai.js's callers take `runImpl`, so the tests need no binary and no login.
//
// What this file will not do: price anything. A Codex or Gemini run reports tokens but no dollars, and
// the cost screen counts a run with no price as UNPRICED, never as free.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const ENGINES = ["cli", "api", "codex", "gemini", "auto"];

/** Auto's order, the one the owner asked for: Gemini first, then Codex, then Claude Code, and the paid API last. */
export const AUTO_ORDER = ["gemini", "codex", "cli", "api"];

/** An engine that just failed is tried last for this long, so a down engine is not re-waited-on by every question. */
export const COOLDOWN_MS = 2 * 60_000;

/** Which engines can read a photo. Codex and Gemini are asked in text only here. */
export const TAKES_IMAGES = new Set(["cli", "api"]);

/**
 * The engines to try, in order, for this choice.
 *
 * A pinned engine is just itself — no silent second provider, because "I chose Codex" followed by an
 * answer from Claude is a cost screen that lies. Only Auto fails over. An engine is left out of Auto's
 * list when it cannot do this question at all (a photo for Codex, the API with no key); that is not a
 * failure, so it is not tried and not reported as one.
 */
export function chainFor(choice, { hasImages = false, hasApiKey = false } = {}) {
  if (choice !== "auto") return [choice];
  return AUTO_ORDER.filter((e) => (!hasImages || TAKES_IMAGES.has(e)) && (e !== "api" || hasApiKey));
}

/** Healthy engines first, in the given order; any that failed within the cooldown go last, still in order. */
export function orderByHealth(chain, failedAt = {}, now = Date.now()) {
  const cooling = (e) => failedAt[e] && now - failedAt[e] < COOLDOWN_MS;
  return [...chain.filter((e) => !cooling(e)), ...chain.filter(cooling)];
}

/**
 * Run the chain: the first engine that answers wins. Returns `{ result, engine, tried }` where `tried`
 * lists every engine that failed first, with why — a failover nobody can see is one nobody can trust.
 */
const NAMES = { api: "The AI API", cli: "Claude Code", codex: "Codex", gemini: "Gemini" };

export async function runChain(chain, runners, input, { failedAt = {}, now = Date.now(), pinned = false } = {}) {
  if (!chain.length) throw new Error("No AI engine can answer this question: every engine in the Auto list is either unable to take it or not set up.");
  const order = pinned ? chain : orderByHealth(chain, failedAt, now);
  const tried = [];
  for (const engine of order) {
    try {
      const result = await runners[engine](input);
      delete failedAt[engine];
      return { result, engine, tried };
    } catch (e) {
      failedAt[engine] = now;
      tried.push({ engine, error: String(e?.message || e).slice(0, 300) });
      // Named: a bare "maintenance" or "usage limit" on a screen says nothing about WHICH engine said it, or where to change it. The raw reason
      // is kept in full after the name, and a test asserts it still matches.
      if (pinned) throw new Error(`${NAMES[engine] || engine} did not answer: ${String(e?.message || e).slice(0, 300)}. Admin → Integrations → AI engine switches it (Auto tries the next one).`);
    }
  }
  throw new Error(`No AI engine could answer. ${tried.map((t) => `${t.engine}: ${t.error}`).join(" · ")}`);
}

/* ------------------------------------------------------------------ */
/* Where the binaries are                                              */
/* ------------------------------------------------------------------ */

/**
 * The same lesson as ai.js's resolveCli, which cost an afternoon: under systemd the PATH is short and a
 * CLI installed under nvm is not on it, and the error ("spawn codex ENOENT") points at the install
 * rather than at the PATH. Look beside the running node, which is where an npm global lives.
 */
export function resolveBinary(name, envVar, { exists = existsSync, execPath = process.execPath, platform = process.platform, env = process.env, home = homedir() } = {}) {
  if (env[envVar]) return env[envVar];
  const ext = platform === "win32" ? ".cmd" : "";
  // Where a CLI really lives on this box, in the order to look: beside node (an npm global under nvm), then
  // the service user's ~/.local/bin (where `agy` is installed — found on the real box, 2026-10-10, after
  // Gemini was silently skipped under Auto: it is NOT on the service's PATH and NOT beside node, so the bare
  // name failed with ENOENT), then the system bin directories.
  const candidates = [join(dirname(execPath), name + ext), join(home, ".local", "bin", name + ext), join("/usr/local/bin", name), join("/usr/bin", name)];
  return candidates.find((p) => exists(p)) || name;
}

export const codexCmd = () => resolveBinary("codex", "AP_CODEX_CLI");
export const geminiCmd = () => resolveBinary("agy", "AP_AGY_CLI");

/* ------------------------------------------------------------------ */
/* Codex                                                               */
/* ------------------------------------------------------------------ */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/**
 * `codex exec --json` writes one JSON event per line. The answer is the final agent message (also
 * written to the -o file, which wins), usage is on `turn.completed`, and a failure's real reason is in
 * an `error` / `turn.failed` event on STDOUT — measured by DevPilot: a usage-limit rejection came back
 * with empty stderr, and without reading it the message was "exited 1: no output".
 */
export function parseCodexRun(stdout, { fileText = "", stderr = "", code = 0 } = {}) {
  let text = "";
  let usage = null;
  let apiError = "";
  let model = "";
  for (const line of String(stdout || "").split("\n")) {
    const s = line.trim();
    if (!s.startsWith("{")) continue;
    try {
      const ev = JSON.parse(s);
      if (ev.type === "turn.completed") {
        usage = ev.usage || usage;
        model = ev.usage?.model || model;
      }
      if (ev.type === "error" || ev.type === "turn.failed") apiError = ev.message || ev.error?.message || apiError;
      if (ev.type === "item.completed" && ev.item?.type === "agent_message" && ev.item.text) text = ev.item.text;
    } catch {
      /* a partial line is not an event */
    }
  }
  text = String(fileText || "").trim() || text;
  if (code !== 0 || !text) {
    throw new Error(`Codex ${code !== 0 ? `exited ${code}` : "produced no result"}: ${(apiError || stderr || "no output").trim().slice(0, 300)}`);
  }
  return {
    text,
    model: model || "codex",
    usage: usage
      ? {
          input_tokens: num(usage.input_tokens ?? usage.inputTokens),
          output_tokens: num(usage.output_tokens ?? usage.outputTokens),
          cache_read_input_tokens: num(usage.cached_input_tokens ?? usage.cache_read_input_tokens ?? usage.input_tokens_details?.cached_tokens),
          cache_creation_input_tokens: 0,
        }
      : null,
    costUsd: null,
  };
}

export function runCodex({ system, prompt, timeoutMs = 120000, spawnImpl = spawn, readFile = readFileSync }) {
  const dir = mkdtempSync(join(tmpdir(), "seopilot-codex-"));
  const outPath = join(dir, "result.txt");
  // Same flags DevPilot runs on this box. --approve-for-me selects the workspace-write sandbox by itself,
  // and Codex rejects an explicit --sandbox beside it.
  const args = ["exec", "--json", "--color", "never", "--approve-for-me", "--skip-git-repo-check", "--ignore-user-config", "-C", dir, "-o", outPath, "-"];
  return new Promise((resolve, reject) => {
    const bin = codexCmd();
    let child;
    try {
      child = spawnImpl(bin, args, { cwd: dir });
    } catch (e) {
      rmSync(dir, { recursive: true, force: true });
      return reject(new Error(`Could not run Codex ("${bin}"): ${e.message}`));
    }
    let out = "";
    let err = "";
    let done = false;
    const finish = (fn) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* a scratch directory that will not delete is the tmp cleaner's problem */
      }
      fn();
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      finish(() => reject(new Error(`Codex took longer than ${Math.round(timeoutMs / 1000)}s and was stopped.`)));
    }, timeoutMs);
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (err += d));
    child.on("error", (e) =>
      finish(() =>
        reject(new Error(e.code === "ENOENT" ? `Codex was not found at "${bin}". Set AP_CODEX_CLI in server/.env to its full path, and sign in to it on the box.` : `Could not run Codex ("${bin}"): ${e.message}`)),
      ),
    );
    child.on("close", (code) =>
      finish(() => {
        let fileText = "";
        try {
          fileText = readFile(outPath, "utf8");
        } catch {
          /* no -o file: the event stream's last message stands in */
        }
        try {
          resolve(parseCodexRun(out, { fileText, stderr: err, code }));
        } catch (e) {
          reject(e);
        }
      }),
    );
    child.stdin?.end(`${system || ""}\n\n---\n\n${prompt || ""}`.trim());
  });
}

/* ------------------------------------------------------------------ */
/* Gemini (the Antigravity CLI, `agy`)                                  */
/* ------------------------------------------------------------------ */

export const GEMINI_MODEL = () => process.env.AP_GEMINI_MODEL || "gemini-3.7-flash";

/**
 * `agy --output-format json` answers with an envelope: `response` (or result/text) is the text, `status`
 * "ERROR" carries `error`, and `usage` has tokens — measured by DevPilot: total == input + output, so
 * thinking tokens are already inside output and are not added again.
 */
export function parseGeminiEnvelope(out, { stderr = "", code = 0 } = {}) {
  const raw = String(out || "").trim();
  let env = null;
  try {
    env = JSON.parse(raw);
  } catch {
    /* plain text is a valid answer from an older build */
  }
  if (env?.status === "ERROR") throw new Error(`Gemini error: ${env.error || "unknown error"}${stderr.trim() ? ` [${stderr.trim().slice(0, 300)}]` : ""}`);
  if (code !== 0 && !raw) throw new Error(`Gemini exited ${code}: ${stderr.trim().slice(0, 300) || "no output"}`);
  const text = String((env && (env.response ?? env.result ?? env.text ?? env.message?.content)) ?? raw).trim();
  if (!text) throw new Error(`Gemini produced no result.${stderr.trim() ? ` [${stderr.trim().slice(0, 300)}]` : ""}`);
  const u = env?.usage;
  return {
    text,
    model: GEMINI_MODEL(),
    usage: u ? { input_tokens: num(u.input_tokens), output_tokens: num(u.output_tokens), cache_read_input_tokens: num(u.cache_read_tokens), cache_creation_input_tokens: 0 } : null,
    costUsd: null,
  };
}

export function runGemini({ system, prompt, timeoutMs = 120000, spawnImpl = spawn }) {
  // The prompt goes in as the positional argument right after --print. DevPilot measured on this very
  // box that piping it on stdin, or putting it after the other flags, makes the CLI try to self-invoke
  // `agy --help` and hit a permission gate that --dangerously-skip-permissions does not cover.
  const args = ["--print", `${system || ""}\n\n---\n\n${prompt || ""}`, "--output-format", "json", "--disable-slash-commands", "--dangerously-skip-permissions", "--model", GEMINI_MODEL()];
  // No `--effort` here: the Gemini CLI rejects it for the default model ("--effort is not supported for model gemini-3.7-flash"), and that
  // rejection took down every "Write again" and analyst answer that fell through to Gemini (found 2026-11-11).
  return new Promise((resolve, reject) => {
    const bin = geminiCmd();
    let child;
    try {
      child = spawnImpl(bin, args, { shell: false });
    } catch (e) {
      return reject(new Error(`Could not run Gemini ("${bin}"): ${e.message}`));
    }
    let out = "";
    let err = "";
    let done = false;
    const finish = (fn) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      finish(() => reject(new Error(`Gemini took longer than ${Math.round(timeoutMs / 1000)}s and was stopped.`)));
    }, timeoutMs);
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (err += d));
    child.on("error", (e) =>
      finish(() => reject(new Error(e.code === "ENOENT" ? `Gemini (agy) was not found at "${bin}". Set AP_AGY_CLI in server/.env to its full path, and sign in to it on the box.` : `Could not run Gemini ("${bin}"): ${e.message}`))),
    );
    child.on("close", (code) =>
      finish(() => {
        try {
          resolve(parseGeminiEnvelope(out, { stderr: err, code }));
        } catch (e) {
          reject(e);
        }
      }),
    );
    child.stdin?.end();
  });
}
