// The small pieces every screen repeats. In one file so a colour rule is decided once.
import type { ReactNode } from 'react'
import { Icon } from './Icons'

/** A server error, shown as the server worded it. Nothing when there is none. */
export function Err({ text }: { text: string }) {
  return text ? <div className="glass p-3 text-sm text-danger border-danger/20">{text}</div> : null
}

/** A success line. */
export function Ok({ text }: { text: string }) {
  return text ? <div className="glass p-3 text-sm text-success">{text}</div> : null
}

export function Empty({ icon: I = Icon.Search, title, body, action }: { icon?: typeof Icon.Search; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="glass p-10 text-center">
      <div className="mx-auto h-14 w-14 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center mb-4">
        <I size={24} className="text-accent" />
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="text-sm text-white/70 mt-1.5 max-w-md mx-auto">{body}</p>
      {action && <div className="mt-5 flex justify-center gap-2">{action}</div>}
    </div>
  )
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="glass h-20 shimmer rounded-2xl" />
      ))}
    </div>
  )
}

const PRIORITY_CLASS = { high: 'pill-risk', medium: 'pill-watch', low: 'pill-muted' } as const

export function PriorityPill({ priority }: { priority: 'high' | 'medium' | 'low' }) {
  return <span className={PRIORITY_CLASS[priority] || 'pill-muted'}>{priority}</span>
}

/** A page title with the sentence under it that says what the screen is for. */
export function PageHead({ title, blurb, right }: { title: ReactNode; blurb?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">{title}</h1>
        {blurb && <p className="text-sm text-white/70 mt-1.5 max-w-[70ch]">{blurb}</p>}
      </div>
      {right}
    </div>
  )
}
