// lib/reconcile.js — the number checker, copied from SEOPilot's analyst.js (factNumbers, numbersIn, reconcile) unchanged in behaviour.
// Every figure in a model's answer must be in the fact sheet it was given, or it is returned in `unsupported` and the screen says so.
// Kept identical on purpose: the two products must judge a fabricated number the same way. If you change one, change the other.

const round2 = (n) => Math.round(Number(n) * 100) / 100;

export function factNumbers(facts) {
  const out = new Set();
  const walk = (v) => {
    if (v == null) return;
    if (typeof v === "number" && Number.isFinite(v)) {
      out.add(String(round2(v)));
      out.add(String(Math.round(v)));
      out.add(String(Math.abs(round2(v))));
      out.add(String(Math.abs(Math.round(v))));
      // One decimal is how a position is said in prose (1.5 for 1.52).
      out.add(String(Math.round(v * 10) / 10));
      out.add(String(Math.abs(Math.round(v * 10) / 10)));
      return;
    }
    if (Array.isArray(v)) return v.forEach(walk);
    if (typeof v === "object") return Object.values(v).forEach(walk);
  };
  walk(facts);
  return out;
}

export function numbersIn(text, { stripNames = true } = {}) {
  // A page address or an id is a NAME, not a claim: "/blog/2024-guide" or "properties/548906392" is a
  // thing being pointed at, and its digits were being asked about as if they were a measurement. Only
  // a slashed token that contains a letter is dropped — "1200/1500" has none, so a figure written as a
  // fraction is still checked. A token ends at a comma, so "/offer,7342" loses the path and keeps 7342.
  // `stripNames: false` is for a file the person attached, where every number in it counts as theirs.
  const withoutNames = stripNames
    ? String(text || "").replace(/[^\s,]*[A-Za-z][^\s,]*\/[^\s,]*|[^\s,]*\/[^\s,]*[A-Za-z][^\s,]*/g, " ")
    : String(text || "");
  const withoutDates = withoutNames.replace(/\d{4}-\d{2}-\d{2}/g, " ");
  const found = withoutDates.match(/-?\d[\d,]*(?:\.\d+)?/g) || [];
  return found.map((raw) => raw.replace(/,/g, "")).filter((n) => n !== "" && n !== "-");
}

const FREE_INTEGER_MAX = 12;

export function reconcile(text, facts, attachedText = "") {
  const known = factNumbers(facts);
  // A file the person attached is THEIR data, handed over with the question. A figure that is in it is
  // accounted for — the answer is told to say it came from the file — so it must not be flagged as
  // missing from the stored data. Only what is neither in the sheet nor in the file is unsupported.
  for (const raw of numbersIn(attachedText, { stripNames: false })) {
    known.add(raw);
    const n = Number(raw);
    if (Number.isFinite(n)) {
      known.add(String(round2(n)));
      known.add(String(Math.round(n)));
    }
  }
  const unsupported = [];
  for (const n of numbersIn(text)) {
    if (known.has(n)) continue;
    const num = Number(n);
    if (!Number.isFinite(num)) continue;
    // Small whole numbers are prose, not claims.
    if (Number.isInteger(num) && Math.abs(num) <= FREE_INTEGER_MAX) continue;
    // A rounded restatement of a known figure is the same claim: 1240.4 → "1240".
    // Only a WHOLE number may stand for a rounded figure: 8 for 8.33 is a restatement, but 1.9 is not 1.5 just because both round to 2.
    if ((Number.isInteger(num) && known.has(String(Math.round(num)))) || known.has(String(round2(num)))) continue;
    unsupported.push(n);
  }
  return { ok: unsupported.length === 0, unsupported: [...new Set(unsupported)] };
}
