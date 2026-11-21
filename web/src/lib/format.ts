// Small formatters, in one place so a number looks the same on every screen.

export function num(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString()
}

/** Compact for headline tiles: 12,400 → 12.4k. Kept exact below 10,000. */
export function compact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (Math.abs(n) < 10_000) return Math.round(n).toLocaleString()
  if (Math.abs(n) < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export function pct(fraction: number | null | undefined, digits = 1): string {
  if (fraction == null || !Number.isFinite(fraction)) return '—'
  return `${(fraction * 100).toFixed(digits)}%`
}

/** A signed percentage for deltas: +18%, -32%, or "—" when there is nothing to compare. */
export function signedPct(fraction: number | null | undefined): string {
  if (fraction == null || !Number.isFinite(fraction)) return '—'
  const v = Math.round(fraction * 100)
  return `${v > 0 ? '+' : ''}${v}%`
}

export function position(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p) || p === 0) return '—'
  return p.toFixed(1)
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`
  return new Date(iso).toLocaleDateString()
}

export function dateRange(r: { start: string; end: string } | null | undefined): string {
  if (!r?.start) return '—'
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  return `${fmt(r.start)} – ${fmt(r.end)}`
}

/** A long URL, shortened from the left so the part that identifies the page survives. */
export function shortUrl(u: string): string {
  try {
    const url = new URL(u)
    return `${url.pathname}${url.search}` || '/'
  } catch {
    return u
  }
}
