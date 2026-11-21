// Types for richtext.js.
//
// The parser is plain JS so `server/test/richtext.test.mjs` can import and run it
// under node with no build step — what turns model output into links is not the piece
// that should be untestable. This file is what keeps the TypeScript side honest.

export type Span =
  | { t: 'text'; v: string }
  | { t: 'b'; v: string }
  | { t: 'code'; v: string }
  | { t: 'link'; v: string; href: string }

export type Block =
  | { type: 'p'; spans: Span[] }
  | { type: 'ul'; items: Span[][] }
  | { type: 'ol'; start: number; items: Span[][] }
  | { type: 'table'; head: Span[][]; align: ('left' | 'right' | 'center' | null)[]; rows: Span[][][] }

/** null unless the url is plainly http(s) — see the note in richtext.js. */
export function safeHref(url: string): string | null

export function inline(text: string): Span[]
export function parse(text: string): Block[]
