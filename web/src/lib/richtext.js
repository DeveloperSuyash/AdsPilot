// src/lib/richtext.js — the small markdown the analyst is allowed to write.
//
// Ported from DevPilot's chat so an answer here reads the same: bold, bullets, code chips and links.
// The reasoning below is DevPilot's and holds here for the same reason — this text is MODEL OUTPUT.
//
// Analyst answers were printed with `whitespace-pre-wrap` and nothing else, so
// every reply arrived as one unbroken block of prose. That is worst exactly where the
// answer is best: a real question ("can you wire the Instagram feed in?") gets nine
// lines of genuine explanation, all of it useful, none of it scannable, read on a
// phone. Bold, a bullet and a clickable link are not decoration there — they are how
// somebody finds the one line they opened the message for.
//
// Plain JS, not TypeScript, so `server/test/richtext.test.mjs` can run it under node
// with no build step. `RichText.tsx` is the only thing that renders what this returns,
// and it builds ELEMENTS from the tree — there is no HTML string anywhere in this
// path, and deliberately no dangerouslySetInnerHTML and no markdown library.
//
// That is a security decision, not a taste one. The text in these bubbles is model
// output, and the model reads live page text through `fetch_url` (see CLAUDE.md).
// Anyone who can put a comment on a connected client's site can therefore put
// characters in here. Parsing to a tree means there is no sanitiser to get wrong: a
// span carries text, and text is all it can ever become.
//
// Unknown syntax is not an error. It renders as the characters the model typed.

/** A line that is a bullet. `·` is here because the server's own reports use it. */
const BULLET = /^\s{0,3}[-*·•]\s+(.*)$/;

/** `1. ` or `1) `, up to two digits — a numbered step, not a year or a price. */
const ORDERED = /^\s{0,3}(\d{1,2})[.)]\s+(.*)$/;

/**
 * A markdown table: a header row, then a separator row of dashes (`|---|:--:|--:|`), then body rows.
 * The separator is what makes it a table: a line that merely contains a pipe stays a sentence.
 */
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const MAX_COLS = 8;
const MAX_ROWS = 30;

/** One table line → its cells. The outer pipes are optional, as models write them both ways. */
function cells(line) {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
  return t.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());
}

/**
 * `**bold**`, `` `code` ``, `[label](url)`, and a bare url. First match wins, left to
 * right. Bold and code stop at a newline on purpose: a stray `**` in the middle of a
 * report must not swallow the next four lines into one bold run.
 */
const INLINE = /\*\*([^*\n]+)\*\*|`([^`\n]+)`|\[([^\]\n]+)\]\(([^\s)]+)\)|(\bhttps?:\/\/[^\s<>"']+)/g;

/**
 * A url at the end of a sentence otherwise swallows the full stop, and the link then
 * 404s on a character the reader cannot see. Closing brackets go too — "(see
 * https://x.test/a)" is the shape this arrives in.
 */
const TRAILING = /[.,;:!?'")\]]+$/;

/**
 * The only hrefs that become links.
 *
 * The allowlist is the whole point: `javascript:`, `data:` and `vbscript:` are how a
 * link becomes script, and a model that has just read an attacker's page comment is
 * exactly the thing that would repeat one. Anything that is not plainly http(s)
 * renders as the words the model wrote — visible, inert, and not silently dropped,
 * because a vanished sentence is its own kind of lie.
 */
export function safeHref(url) {
  const u = String(url || "").trim();
  return /^https?:\/\/[^\s]+$/i.test(u) ? u : null;
}

/** What a bare url reads as. The scheme is eight characters of nothing on a phone. */
function label(url) {
  return url.replace(/^https?:\/\//i, "");
}

/**
 * One line (or one paragraph) of text → spans.
 *
 * Span kinds: `text`, `b`, `code`, `link` (which also carries `href`).
 */
export function inline(text) {
  const spans = [];
  const push = (t, v) => {
    if (v) spans.push({ t, v });
  };
  let last = 0;
  let m;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text))) {
    if (m.index > last) push("text", text.slice(last, m.index));
    const [raw, bold, code, linkLabel, linkUrl, bare] = m;
    if (bold !== undefined) push("b", bold);
    else if (code !== undefined) push("code", code);
    else if (linkLabel !== undefined) {
      const href = safeHref(linkUrl);
      if (href) spans.push({ t: "link", v: linkLabel, href });
      else push("text", raw);
    } else if (bare !== undefined) {
      const trail = (bare.match(TRAILING) || [""])[0];
      const url = trail ? bare.slice(0, bare.length - trail.length) : bare;
      const href = safeHref(url);
      if (href) spans.push({ t: "link", v: label(url), href });
      else push("text", url);
      push("text", trail);
    }
    last = m.index + raw.length;
  }
  if (last < text.length) push("text", text.slice(last));
  return spans;
}

/**
 * A message → blocks.
 *
 * Block kinds: `p` (spans, newlines kept), `ul` (items), `ol` (items + start), `table` (head, align, rows).
 * A blank line is a separator and produces nothing of its own — the gap between
 * blocks is the renderer's margin, so one stray double newline cannot open a hole in
 * the middle of a bubble.
 */
export function parse(text) {
  const lines = String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trim()) {
      i++;
      continue;
    }
    // A table needs its separator row on the very next line; without it the line is ordinary text.
    if (lines[i].includes("|") && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const head = cells(lines[i]).slice(0, MAX_COLS);
      const align = cells(lines[i + 1]).slice(0, head.length).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : null));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|") && rows.length < MAX_ROWS) {
        const row = cells(lines[i]).slice(0, head.length);
        while (row.length < head.length) row.push("");
        rows.push(row.map((c) => inline(c)));
        i++;
      }
      blocks.push({ type: "table", head: head.map((c) => inline(c)), align, rows });
      continue;
    }
    let m = lines[i].match(BULLET);
    if (m) {
      const items = [];
      while (i < lines.length && (m = lines[i].match(BULLET))) {
        items.push(inline(m[1]));
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }
    m = lines[i].match(ORDERED);
    if (m) {
      const start = Number(m[1]);
      const items = [];
      while (i < lines.length && (m = lines[i].match(ORDERED))) {
        items.push(inline(m[2]));
        i++;
      }
      blocks.push({ type: "ol", start, items });
      continue;
    }
    // Consecutive plain lines are ONE paragraph with its newlines kept, rather than a
    // paragraph each. The report puts a heading immediately above its bullets, and a
    // margin between those two would read as a gap the writer did not put there.
    const para = [];
    while (i < lines.length && lines[i].trim() && !BULLET.test(lines[i]) && !ORDERED.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ type: "p", spans: inline(para.join("\n")) });
  }
  return blocks;
}
