// lib/ai.js — the only place AdsPilot talks to a model.
//
// One function, one shape: text in, text out. Everything that decides WHAT to ask lives
// in analyst.js, and everything that decides whether the answer is allowed to be shown
// lives there too. This file just runs it.
//
// Five choices, set install-wide in Administration (or AP_AI_ENGINE as the default): cli, api, codex,
// gemini, and auto, which fails over gemini -> codex -> cli -> api for these one-shot calls. A pinned
// engine never silently falls back to another: "I chose Codex" answered by Claude would make the usage
// screen lie. Codex and Gemini live in engines.js. The two original engines:
//
//   cli — the `claude` binary on the box, signed in with a subscription. Costs nothing
//         per call, which is why it is the default. Two things to know about it: it is
//         one process per question, so ten workspaces asking at once queue behind each
//         other; and a subscription is meant for the person who holds it, which is a
//         real consideration once AdsPilot is being sold rather than used in-house.
//
//   api — the Anthropic API. Costs money per call, but it is concurrent, it is the
//         right footing for a product with customers, and the per-call cost here is
//         small because the model receives a fact sheet, never raw rows.
//
// The split exists so that day is a config change, not a rewrite. `AP_AI_ENGINE`
// chooses; nothing above this file knows which one ran.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { ENGINES, chainFor, runChain, runCodex, runGemini, codexCmd, geminiCmd, GEMINI_MODEL } from "./engines.js";

/** What the platform admin picked in Administration. Beats the env default, because the screen must be able to change it. */
let chosen = "";
export function setEngine(v) {
  chosen = ENGINES.includes(v) ? v : "";
}
const ENGINE = () => {
  const e = (chosen || process.env.AP_AI_ENGINE || "cli").toLowerCase();
  return ENGINES.includes(e) ? e : "cli";
};

/** When each engine last failed, in memory: a restart is exactly when an old failure stops being evidence. */
const failedAt = {};
export function engineStatus() {
  return {
    engine: ENGINE(),
    source: chosen ? "admin" : process.env.AP_AI_ENGINE ? "env" : "default",
    hasApiKey: !!process.env.AP_AI_API_KEY,
    lastFailure: Object.fromEntries(Object.entries(failedAt).map(([k, t]) => [k, new Date(t).toISOString()])),
    where: { cli: resolveCli(), codex: codexCmd(), gemini: geminiCmd() },
  };
}

/**
 * Where the `claude` binary actually is.
 *
 * A bare "claude" works in a shell and fails under systemd, which is exactly how this
 * broke: the unit runs with PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:
 * /snap/bin, and the CLI is installed under nvm — not on that list. The error is
 * `spawn claude ENOENT`, which says nothing about PATH and sends you looking at the
 * install instead.
 *
 * It is found next to the node that is running this process. That is not a guess:
 * `claude` is an npm global, npm globals live in the same bin directory as the node
 * they were installed under, and `process.execPath` is that node. It also survives a
 * node upgrade, which a hardcoded version path would not.
 */
export function resolveCli() {
  if (process.env.AP_AI_CLI) return process.env.AP_AI_CLI;
  const beside = join(dirname(process.execPath), process.platform === "win32" ? "claude.cmd" : "claude");
  if (existsSync(beside)) return beside;
  return "claude"; // on PATH, or about to fail with a message that now explains itself
}

const CLI = () => resolveCli();
const MODEL = () => process.env.AP_AI_MODEL || "claude-opus-5";
const TIMEOUT_MS = Number(process.env.AP_AI_TIMEOUT_MS || 120000);

export function engineName() {
  return ENGINE();
}

/** Is there anything to run at all? Checked before a question is accepted, not after. */
export function isConfigured() {
  if (ENGINE() === "api") return !!process.env.AP_AI_API_KEY;
  return true; // the CLI's absence surfaces as a clear spawn error below
}

/**
 * Ask the model one question.
 *
 * `runImpl` is injectable for the same reason `requestImpl` is in google.js: the tests
 * must run with no network, no subscription and no API key. Nothing about the analyst's
 * behaviour should depend on a model actually being reachable.
 *
 * Returns `{ text, usage, costUsd, model, engine }` rather than a bare string — DevPilot
 * shipped a cost screen that could only ever say "saved" because it discarded the API
 * response's own `usage` field, and the same field was sitting unread here too. `usage`
 * and `costUsd` are null when the caller passed its own `runImpl` (the tests) or when a
 * result genuinely carries none, which callers must treat as "not measured", never as
 * zero cost.
 */
let gate = null;
/** One place that can refuse an AI run before it costs anything (a per-workspace daily limit). Tests that inject a runImpl never pass through it. */
export const setAiGate = (fn) => {
  gate = typeof fn === "function" ? fn : null;
};

export async function ask({ system, prompt, images = [] }, runImpl = null) {
  if (gate && !runImpl) await gate();
  // `images` is [{ mediaType, data }] with `data` base64. Empty for every text question, and a
  // runImpl that predates images simply never looks at it.
  const input = { system, prompt, images };
  let r;
  let engine = ENGINE();
  let tried = [];
  if (runImpl) {
    r = await runImpl(input);
  } else {
    const choice = ENGINE();
    const chain = chainFor(choice, { hasImages: images.length > 0, hasApiKey: !!process.env.AP_AI_API_KEY });
    const ran = await runChain(chain, RUNNERS, input, { failedAt, pinned: choice !== "auto" });
    r = ran.result;
    engine = ran.engine;
    tried = ran.tried;
  }
  // A test's injected runImpl still returns a bare string — that contract does not
  // change, so a string result is wrapped rather than required to grow fields it has no
  // way to know.
  const result = typeof r === "string" ? { text: r } : r;
  return {
    text: String(result.text || "").trim(),
    usage: result.usage || null,
    costUsd: typeof result.costUsd === "number" ? result.costUsd : null,
    // The engine that ANSWERED, and the model it used: under Auto they are not the ones asked for first.
    model: result.model || MODEL(),
    engine,
    // Engines that failed before this one answered. Empty when the first choice worked.
    tried,
  };
}

/** Codex and Gemini take text only here; a photo question under a pinned one is refused, not quietly dropped. */
const textOnly = (name, run) => (input) => {
  if (input.images?.length) throw new Error(`${name} cannot read photos here. Pick Claude Code or Auto to ask a question with a screenshot.`);
  return run({ system: input.system, prompt: input.prompt, timeoutMs: TIMEOUT_MS });
};
const RUNNERS = {
  cli: (i) => askCli(i),
  api: (i) => askApi(i),
  codex: textOnly("Codex", runCodex),
  gemini: textOnly("Gemini", runGemini),
};

/**
 * The CLI path.
 *
 * `-p` is headless: it answers and exits instead of opening a session. The system prompt
 * goes through `--append-system-prompt` rather than being pasted into the question,
 * because a rule buried inside user text is a rule the model may treat as the user's
 * opinion — and the rule here is "never invent a number".
 *
 * The question arrives on stdin, not as an argument. A fact sheet is thousands of
 * characters and an argument list has a length limit; the failure when you exceed it is
 * a truncated prompt, which produces a confident answer about half the data.
 */
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const IMAGE_MAX_COUNT = 3;
/** Decoded bytes per image. The browser sends far less (it shrinks to a JPEG); this is the ceiling for anyone who is not the browser. */
const IMAGE_MAX_BYTES = 2.5 * 1024 * 1024;

/**
 * The `images` field of an ask → a clean list, or an error naming the problem.
 * Anything that is not plainly a small base64 image of a known type is refused, not passed along.
 */
export function validateImages(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error("Photos were not sent in a form the analyst can read.");
  if (raw.length > IMAGE_MAX_COUNT) throw new Error(`Attach up to ${IMAGE_MAX_COUNT} photos to one question.`);
  return raw.map((i) => {
    const mediaType = String(i?.mediaType || "").toLowerCase();
    const data = String(i?.data || "");
    if (!IMAGE_TYPES.has(mediaType)) throw new Error("Photos must be PNG, JPEG, WebP or GIF.");
    if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error("One of the photos could not be read.");
    if (Math.floor((data.length * 3) / 4) > IMAGE_MAX_BYTES) throw new Error("One of the photos is too big. Use a smaller screenshot.");
    return { mediaType, data };
  });
}


/**
 * What goes to the CLI on stdin when the question carries images.
 *
 * Plain `-p` takes text only. An image needs the CLI's stream-json input, which is one JSON message
 * per line and accepts the same content blocks as the API: the images, then the text. Pure, so the
 * shape is testable without a model.
 */
export function buildCliInput({ prompt, images = [] }) {
  const content = [
    ...images.map((i) => ({ type: "image", source: { type: "base64", media_type: i.mediaType, data: i.data } })),
    { type: "text", text: prompt },
  ];
  return JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n";
}

/**
 * The CLI's stream-json output → the same `{ text, usage, costUsd }` the json format gives.
 *
 * The stream is one event per line; the answer is the line whose type is "result". A run that ends
 * in an error says so on that same line, and is thrown rather than returned as if it were an answer.
 */
export function parseStreamResult(out) {
  let result = null;
  for (const line of String(out || "").split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const j = JSON.parse(line);
      if (j?.type === "result") result = j;
    } catch {
      /* a partial or non-JSON line is not the result */
    }
  }
  if (!result) throw new Error("The analyst gave no answer to the image question.");
  if (result.is_error) throw new Error(String(result.result || "The analyst could not answer.").slice(0, 300));
  return { text: String(result.result || ""), usage: result.usage || null, costUsd: typeof result.total_cost_usd === "number" ? result.total_cost_usd : null };
}

function askCli({ system, prompt, images = [] }) {
  const withImages = images.length > 0;
  return new Promise((resolve, reject) => {
    // `--output-format json` instead of plain text for one reason: the CLI's own result
    // object carries `usage` and `total_cost_usd`, and DevPilot's own history is that
    // Claude Code reports its tokens on this line and a screen that never read it
    // reported real spend as zero. Plain text throws that number away for good.
    const args = withImages
      ? ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--append-system-prompt", system, "--model", MODEL()]
      : ["-p", "--append-system-prompt", system, "--model", MODEL(), "--output-format", "json"];
    const child = spawn(CLI(), args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, HOME: process.env.HOME || "/home/ubuntu" },
    });

    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`The analyst took longer than ${Math.round(TIMEOUT_MS / 1000)}s and was stopped.`));
    }, TIMEOUT_MS);

    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      // ENOENT here means the binary was not found, and the message that ships with it
      // ("spawn claude ENOENT") sends people to check the install rather than the PATH
      // the service runs under. Say which path was tried.
      if (e.code === "ENOENT") {
        return reject(
          new Error(
            `The analyst binary was not found at "${CLI()}". The service runs with a limited PATH — set AP_AI_CLI in server/.env to its full path.`,
          ),
        );
      }
      reject(new Error(`Could not run the analyst (${CLI()}): ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const why = shortError(err) || `The analyst exited with code ${code}.`;
        // An old CLI has no stream-json input, and its own error ("unknown option") does not say
        // that the photo is the cause.
        return reject(new Error(withImages ? `Photos need a newer analyst CLI on the server. ${why}` : why));
      }
      try {
        resolve(withImages ? parseStreamResult(out) : parseCliResult(out));
      } catch (e) {
        reject(e);
      }
    });

    child.stdin.end(withImages ? buildCliInput({ prompt, images }) : prompt);
  });
}

/**
 * The CLI's `--output-format json` result, or a plain-text fallback.
 *
 * A CLI old enough to predate this flag, or one running under a config that overrides
 * it, still answers with plain text — and a broken JSON parse here must not turn a
 * working answer into a failed one. `usage`/`total_cost_usd` are simply absent then,
 * which the caller already treats as "not measured" rather than zero.
 */
function parseCliResult(out) {
  try {
    const j = JSON.parse(out);
    if (j && typeof j.result === "string") {
      return { text: j.result, usage: j.usage || null, costUsd: typeof j.total_cost_usd === "number" ? j.total_cost_usd : null };
    }
  } catch {
    /* not JSON — fall through to the raw text */
  }
  return { text: out };
}

/**
 * "Not logged in · Please run /login" is the single most common CLI failure and the
 * least self-explanatory when it arrives wrapped in a stack trace. DevPilot lost an
 * afternoon to it, so it gets named here rather than passed through raw.
 */
function shortError(stderr) {
  const s = String(stderr || "").trim();
  if (/not logged in|\/login|invalid bearer token|401/i.test(s)) {
    return "The analyst is not signed in on the server. Someone has to run `claude` and `/login` on the box.";
  }
  return s.split("\n").slice(0, 2).join(" ").slice(0, 300);
}

/** The API path. Same contract, different plumbing. */
export async function askApi({ system, prompt, images = [] }, fetchImpl = fetch) {
  const key = process.env.AP_AI_API_KEY;
  if (!key) throw new Error("AP_AI_API_KEY is not set.");
  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL(),
      max_tokens: 2000,
      system,
      // Text only stays a plain string, as it always was; images make it content blocks.
      messages: [
        {
          role: "user",
          content: images.length
            ? [...images.map((i) => ({ type: "image", source: { type: "base64", media_type: i.mediaType, data: i.data } })), { type: "text", text: prompt }]
            : prompt,
        },
      ],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `The analyst API answered ${res.status}.`);
  const text = (body.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  // The API bills in tokens, not dollars — lib/cost.js's `costOf` turns `usage` into a
  // dollar figure at the point it is recorded, same file the CLI's own total_cost_usd
  // is never re-priced against.
  return { text, usage: body.usage || null };
}
