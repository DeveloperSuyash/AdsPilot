import type { ReactNode } from 'react'
import { parse, type Block, type Span } from '../lib/richtext'

/**
 * The analyst's answer, rendered the way DevPilot renders its chat: bold, bullets, code chips, links.
 *
 * `richtext.js` holds the parsing and the reasoning, including why this builds elements instead of
 * setting HTML. Everything here is layout, plus one thing DevPilot does not need.
 *
 * PAGE PATHS. The analyst is told to write a page as its path ("/pricing") and not as a link, so it
 * can never invent or misspell a host. Here a path becomes a link on the project's OWN site. A path
 * is only recognised after a boundary and with a letter or digit after the slash, so "and/or",
 * "1200/1500" and "clicks / impressions" stay text. The home page, a lone "/", is linked only at the
 * start of a line, where it cannot be mistaken for a separator.
 */

/** "sc-domain:acme.com", "https://www.acme.com/x" and "acme.com" all become https://host. Empty when unusable. */
export function siteOrigin(domain: string): string {
  const host = String(domain || '')
    .trim()
    .replace(/^sc-domain:/i, '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
  return host ? `https://${host}` : ''
}

const PATH = /(^|[\s(\["'`])(\/[A-Za-z0-9][^\s)\]>"'`,;]*)/g

const linkClass =
  'text-accent font-medium underline underline-offset-2 decoration-accent/40 hover:decoration-accent [overflow-wrap:anywhere]'

function Anchor({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className={linkClass}>
      {children}
    </a>
  )
}

/** Plain text with its page paths turned into links. */
function Paths({ text, origin, lineStart }: { text: string; origin: string; lineStart: boolean }) {
  if (!origin) return <>{text}</>
  const out: ReactNode[] = []
  let rest = text
  let k = 0
  // A lone "/" opening a line is the home page.
  if (lineStart && /^\/(?=\s|$)/.test(rest)) {
    out.push(
      <Anchor key={k++} href={`${origin}/`}>
        /
      </Anchor>,
    )
    rest = rest.slice(1)
  }
  let last = 0
  for (const m of rest.matchAll(PATH)) {
    const start = (m.index ?? 0) + m[1].length
    // A sentence's full stop or colon is not part of the address.
    const path = m[2].replace(/[.:!?]+$/, '')
    out.push(rest.slice(last, start))
    out.push(
      <Anchor key={k++} href={origin + path}>
        {path}
      </Anchor>,
    )
    last = start + path.length
  }
  out.push(rest.slice(last))
  return <>{out}</>
}

function Spans({ spans, origin }: { spans: Span[]; origin: string }) {
  return (
    <>
      {spans.map((s, i) => {
        if (s.t === 'b') return <b key={i} className="font-semibold text-white">{s.v}</b>
        if (s.t === 'code')
          return (
            <code key={i} className="font-mono text-[0.92em] rounded bg-white/[0.08] border border-hairline px-1 py-px text-white/95">
              {s.v}
            </code>
          )
        if (s.t === 'link') return <Anchor key={i} href={s.href}>{s.v}</Anchor>
        return <Paths key={i} text={s.v} origin={origin} lineStart={i === 0} />
      })}
    </>
  )
}

/** A wrapped bullet hangs under its text, not under its dot — `whitespace-pre-wrap` gave the opposite. */
function Item({ marker, spans, origin }: { marker: ReactNode; spans: Span[]; origin: string }) {
  return (
    <li className="flex gap-2 items-start">
      <span className="shrink-0 select-none text-accent leading-relaxed" aria-hidden="true">
        {marker}
      </span>
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <Spans spans={spans} origin={origin} />
      </span>
    </li>
  )
}

/** A cell that is only a figure (1.13, 1,240, 3.1%, +4, -2): right-aligned and tabular so the digits line up down the column. */
const FIGURE = /^[+\-−–~]?\s*[\d][\d.,\s]*%?$/
const plain = (spans: Span[]) => spans.map((x) => x.v).join('').trim()

/**
 * The analyst's figures as a table. It scrolls sideways inside its own card on a phone instead of widening the bubble, the header stays
 * readable on the dark theme, and a column that is all numbers is right-aligned so positions and impressions can be compared by eye.
 * Cells are built from spans like everything else here, so a page path in the first column still becomes a link and nothing is HTML.
 */
function Table({ block, origin }: { block: Extract<Block, { type: 'table' }>; origin: string }) {
  const numeric = block.head.map((_, c) => block.rows.length > 0 && block.rows.every((r) => !plain(r[c] || []) || FIGURE.test(plain(r[c] || []))))
  const align = (c: number) => (block.align[c] === 'center' ? 'text-center' : block.align[c] === 'right' || (block.align[c] == null && numeric[c] && c > 0) ? 'text-right tabular-nums' : 'text-left')
  return (
    <div className="my-2 overflow-x-auto rounded-xl border border-hairline bg-white/[0.02]">
      <table className="w-full min-w-[320px] border-collapse text-[13px]">
        <thead>
          <tr className="bg-white/[0.05]">
            {block.head.map((h, c) => (
              <th key={c} scope="col" className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-white/65 whitespace-nowrap ${align(c)}`}>
                <Spans spans={h} origin={origin} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r} className="border-t border-hairline odd:bg-transparent even:bg-white/[0.025] hover:bg-white/[0.05]">
              {row.map((cell, c) => (
                <td key={c} className={`px-3 py-2 align-top ${c === 0 ? 'font-medium text-white min-w-[8rem] max-w-[15rem] [overflow-wrap:break-word]' : 'text-white/85 whitespace-nowrap'} ${align(c)}`}>
                  <Spans spans={cell} origin={origin} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Blocks({ block, origin }: { block: Block; origin: string }) {
  if (block.type === 'table') return <Table block={block} origin={origin} />
  if (block.type === 'ul')
    return (
      <ul className="my-1.5 space-y-1">
        {block.items.map((spans, i) => (
          <Item key={i} marker="•" spans={spans} origin={origin} />
        ))}
      </ul>
    )
  if (block.type === 'ol')
    return (
      <ol className="my-1.5 space-y-1">
        {block.items.map((spans, i) => (
          <Item key={i} marker={`${block.start + i}.`} spans={spans} origin={origin} />
        ))}
      </ol>
    )
  return (
    <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
      <Spans spans={block.spans} origin={origin} />
    </p>
  )
}

export default function RichText({ text, domain = '', className = '' }: { text: string; domain?: string; className?: string }) {
  const origin = siteOrigin(domain)
  return (
    <div className={`space-y-2 leading-relaxed ${className}`}>
      {parse(text).map((b, i) => (
        <Blocks key={i} block={b} origin={origin} />
      ))}
    </div>
  )
}
