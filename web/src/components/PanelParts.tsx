// The panel, KPI tile and data table the Content, Keywords & Rankings and Off-Page screens share. They keep the props of the
// SeoBits Card / Stat / Table they replace so the screens' logic did not have to move, and wear the approved design's classes
// (.panel, .kpi, .data-table). Kept in its own file because SeoBits is shared with screens that have not been re-laid out.
import type { ReactNode } from 'react'

/** A titled panel. `flush` removes the body padding for a table or list that should run edge to edge. */
export function Card({ title, right, children, flush = false }: { title?: ReactNode; right?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className="panel">
      {(title || right) && (
        <div className="panel-head">
          {title && <h3 className="panel-title">{title}</h3>}
          {right}
        </div>
      )}
      <div className={flush ? '' : 'p-[18px]'}>{children}</div>
    </section>
  )
}

/** A headline figure. The value is whatever the caller already decided is honest to show. */
export function Stat({ k, v, s }: { k: string; v: ReactNode; s?: string }) {
  return (
    <div className="kpi">
      <div className="text-[12.5px] text-white/65">{k}</div>
      <div className="text-[26px] font-semibold tracking-[-0.03em] leading-[1.1] mt-1.5">{v}</div>
      {s && <div className="mt-2 text-xs text-white/60">{s}</div>}
    </div>
  )
}

/** A table that scrolls sideways inside its panel on a phone instead of widening the page. */
export function Table({ head, children, min = 560 }: { head: ReactNode[]; children: ReactNode; min?: number }) {
  return (
    <div className="overflow-x-auto -mx-[18px] -mb-[18px]">
      <table className="data-table" style={{ minWidth: min }}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

/** A quiet note under a table or form: where a number comes from, what it is not. */
export function Note({ children }: { children: ReactNode }) {
  return <p className="text-[11.5px] text-white/50 leading-relaxed mt-3">{children}</p>
}
