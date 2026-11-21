// AdsPilot — one client's Google Ads account: what the last sync read, what it found, the changes it suggests, ad copy, questions, settings.
//
// Ported from SEOPilot's Ads screen. The state is loaded ONCE by the client page and shared by every tab (and by the connection card
// above them), so switching tab does not re-read the account. Every write goes
// through a confirm dialog and is refused by the server unless changes are allowed for this account; the screen says why a button is
// off rather than hiding it. Errors from the server are shown as they come: they are written for people.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from './Icons'
import { Err } from './Bits'
import { Card, Note, Table } from './PanelParts'
import RichText from './RichText'
import { api } from '../lib/api'
import { dateRange, num, timeAgo } from '../lib/format'
import { useCostVisible } from '../lib/cost'
import type { AdsDraft, AdsMetric, AdsProposal, AdsState } from '../lib/types'

/* ------------------------------------------------------------------ formatting */

/** Money in the account's own currency. Never micros (the server already converted). An unknown currency is a plain number, not a guess. */
function moneyOf(currency: string) {
  let fmt: Intl.NumberFormat | null = null
  try {
    if (currency) fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 })
  } catch {
    fmt = null
  }
  return (n: number | null | undefined) => {
    if (n == null || !Number.isFinite(n)) return '—'
    return fmt ? fmt.format(n) : `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ''}`
  }
}

const decimals = (n: number | null | undefined, d = 2) => (n == null || !Number.isFinite(n) ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: d }))

function metricValue(m: { format: AdsMetric['format'] }, v: number | null, money: (n: number | null) => string) {
  if (v == null || !Number.isFinite(v)) return '—'
  if (m.format === 'money') return money(v)
  if (m.format === 'ratio') return `${decimals(v)}×`
  // Percent figures come from the server already in percent (3.4 means 3.4%).
  if (m.format === 'percent') return `${decimals(v, 1)}%`
  return decimals(v)
}

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')

/* ------------------------------------------------------------------ small parts */

/** A modal that asks before anything is written. `ready` lets a dialog require a tick box first. */
function Confirm({
  title,
  children,
  confirmLabel,
  busy,
  ready = true,
  error,
  onConfirm,
  onClose,
}: {
  title: string
  children: ReactNode
  confirmLabel: string
  busy: boolean
  ready?: boolean
  error?: string
  onConfirm: () => void
  onClose: () => void
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [busy, onClose])
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/55" onClick={() => !busy && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="glass w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="btn-ghost h-8 w-8 p-0" aria-label="Close" disabled={busy} onClick={onClose}>
            <Icon.X size={15} />
          </button>
        </div>
        <div className="mt-3 text-sm text-white/80 leading-relaxed space-y-2">{children}</div>
        {error && <p className="text-sm text-danger mt-3">{error}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn-ghost" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary disabled:opacity-40" disabled={busy || !ready} onClick={onConfirm}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function Step({ done, title, who, children }: { done: boolean; title: string; who: string; children?: ReactNode }) {
  return (
    <li className="flex items-start gap-3 py-2.5 border-b border-hairline last:border-0">
      <span className={`mt-0.5 h-5 w-5 rounded-full grid place-items-center shrink-0 ${done ? 'bg-success/20 text-success' : 'bg-white/[0.06] text-white/50'}`}>
        {done ? <Icon.Check size={12} /> : <span className="h-1.5 w-1.5 rounded-full bg-white/40" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className={`text-sm ${done ? 'text-white/70' : 'text-white font-medium'}`}>{title}</div>
        {!done && (
          <div className="text-xs text-white/60 mt-0.5 leading-relaxed">
            <span className="text-white/80">Who: {who}.</span> {children}
          </div>
        )}
      </div>
    </li>
  )
}

/* ------------------------------------------------------------------ the screen */

export function AdsPilot({
  projectId,
  view,
  s,
  setS,
  goTab,
}: {
  projectId: string
  view: string
  s: AdsState
  setS: (s: AdsState) => void
  goTab: (v: string) => void
}) {
  const currency = s.sync?.account.currency || s.findings?.currency || ''
  const props = { projectId, s, setS, money: moneyOf(currency), goTab }

  return (
    <div className="space-y-4">
      {view === 'terms' ? (
        <SearchTerms {...props} />
      ) : view === 'changes' ? (
        <Changes {...props} />
      ) : view === 'copy' ? (
        <AdCopy {...props} />
      ) : view === 'ask' ? (
        <Ask {...props} />
      ) : view === 'settings' ? (
        <AdsSettings {...props} />
      ) : (
        <Overview {...props} />
      )}
    </div>
  )
}

type TabProps = { projectId: string; s: AdsState; setS: (s: AdsState) => void; money: (n: number | null | undefined) => string; goTab: (v: string) => void }

/** The connection card sits at the top of the client's own page; this scrolls to it rather than sending anyone to another screen. */
function toConnection() {
  document.getElementById('google-connection')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
function ConnLink({ children }: { children: ReactNode }) {
  return (
    <button type="button" className="text-accent hover:underline" onClick={toConnection}>
      {children}
    </button>
  )
}

/** One sentence for every tab that has nothing to read until a sync exists. */
function NeedsSync({ s, goTab }: { s: AdsState; goTab: (v: string) => void }) {
  return (
    <div className="glass p-4 text-sm text-white/75">
      Nothing has been read from Google Ads yet{s.lastSync && !s.lastSync.ok ? ' (the last attempt failed)' : ''}.{' '}
      <button className="text-accent hover:underline" onClick={() => goTab('overview')}>
        Finish the setup on Overview
      </button>{' '}
      and sync the account first.
    </div>
  )
}

/* ------------------------------------------------------------------ Overview */

function Overview({ projectId, s, setS, money, goTab }: TabProps) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const admin = useCostVisible()
  const ready = s.setup.developerToken && s.setup.connected && s.setup.accountChosen
  const why = !s.setup.developerToken
    ? 'Google Ads is not switched on for this install yet.'
    : !s.setup.connected
      ? 'Connect Google Ads first.'
      : !s.setup.accountChosen
        ? 'Pick the Google Ads account first.'
        : ''

  const sync = async () => {
    setBusy(true)
    setErr('')
    try {
      setS(await api.adsSync(projectId))
    } catch (e: any) {
      setErr(e.message)
      // The server stored the failure; read it back so "last sync" says so.
      api.adsState(projectId).then(setS).catch(() => {})
    } finally {
      setBusy(false)
    }
  }

  const f = s.findings
  const openProposals = s.proposals.filter((p) => p.status === 'open').length
  const allDone = ready && !!s.sync

  return (
    <>
      {!allDone && (
        <Card title="Setting up AdsPilot">
          <ol>
            <Step done={s.setup.developerToken} title="Google Ads switched on for this install" who="the platform administrator">
              {admin ? (
                <>
                  Add the developer token (and the Google OAuth client, if it is not there yet) under{' '}
                  <Link to="/app/admin" className="text-accent hover:underline">
                    Admin
                  </Link>
                  .
                </>
              ) : (
                'They add the Google Ads developer token under Admin. Nothing on this screen can read the account until then.'
              )}
            </Step>
            <Step done={s.setup.connected} title="Google Ads connected for this client" who="anyone in your workspace with access to the Google Ads account">
              Press Connect Google Ads in the <ConnLink>Google Ads connection</ConnLink> card above. Google’s permission for Ads always includes changes; AdsPilot stays read-only until changes are allowed on the Changes tab.
            </Step>
            <Step done={s.setup.accountChosen} title="Google Ads account chosen" who="anyone in your workspace">
              Choose which account this client is in the <ConnLink>Google Ads connection</ConnLink> card above.{s.connection?.listError ? <span className="block text-danger mt-1">{s.connection.listError}</span> : null}
            </Step>
            <Step done={!!s.sync} title="Account read for the first time" who="you, with the button below">
              It reads the last 28 days and then repeats about once a day on its own.
            </Step>
          </ol>
        </Card>
      )}

      <section className="panel">
        <div className="panel-head">
          <h3 className="panel-title">{s.sync ? s.sync.account.name || `Account ${s.sync.account.id}` : 'Google Ads account'}</h3>
          <button className="btn-primary h-8 px-3 text-xs disabled:opacity-40" disabled={busy || !ready} title={why || undefined} onClick={() => void sync()}>
            <Icon.Refresh size={13} /> {busy ? 'Reading Google Ads…' : 'Sync now'}
          </button>
        </div>
        <div className="panel-body text-sm space-y-1.5">
          {!ready && <p className="text-xs text-white/60">{why} Sync is off until then.</p>}
          {s.lastSync ? (
            <p className="text-white/75">
              Last sync {timeAgo(s.lastSync.at)} ({when(s.lastSync.at)}){s.lastSync.ok ? '.' : ' — it failed:'}
              {!s.lastSync.ok && <span className="block text-danger mt-1">{s.lastSync.error}</span>}
            </p>
          ) : (
            <p className="text-white/60">Never synced.</p>
          )}
          {s.sync && (
            <p className="text-white/70">
              Period {dateRange(s.sync.range.current)}, compared with {dateRange(s.sync.range.previous)}. The data is the last {s.sync.range.days} days ending
              yesterday; recent conversions can still arrive, so the newest days may look worse than they will.
            </p>
          )}
        </div>
      </section>
      <Err text={err} />

      {s.sync && f && (
        <>
          {f.tracking && (
            <div role="alert" className="glass p-4 border-danger/30 flex items-start gap-3">
              <Icon.AlertTriangle size={18} className="text-danger mt-0.5 shrink-0" />
              <div className="text-sm">
                <div className="text-white font-medium">{f.tracking.kind === 'stopped' ? 'Conversions stopped being recorded' : 'No conversions are being recorded'}</div>
                <div className="text-white/75 mt-0.5 leading-relaxed">{f.tracking.detail}</div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            {s.sync.metrics.map((m) => (
              <MetricTile key={m.key} m={m} money={money} />
            ))}
          </div>

          {f.notes.length > 0 && (
            <div className="glass p-3.5 text-[13px] text-white/75 space-y-1">
              {f.notes.map((n, i) => (
                <p key={i}>{n}</p>
              ))}
            </div>
          )}

          <Card title="What it found">
            <div className="grid sm:grid-cols-2 gap-2">
              <FindingLink n={f.wastedTerms.length} label="search terms that spent with no conversion" onClick={() => goTab('terms')} />
              <FindingLink n={f.negativeWords.length} label="words that keep appearing in those terms" onClick={() => goTab('terms')} />
              <FindingLink n={f.lowQuality.length} label="keywords with a low Quality Score" onClick={() => goTab('terms')} />
              <FindingLink n={f.disapproved.length} label="disapproved ads" onClick={() => goTab('terms')} />
              <FindingLink n={f.budgetLimited.length} label="campaigns held back by their budget" onClick={() => goTab('changes')} />
              <FindingLink n={openProposals} label="suggested changes waiting for you" onClick={() => goTab('changes')} />
              <FindingLink n={f.weakAds.length} label="ads with few headlines or descriptions" onClick={() => goTab('copy')} />
            </div>
          </Card>

          <Card title="Campaigns" flush>
            {s.sync.campaigns.length === 0 ? (
              <p className="p-[18px] text-sm text-white/60">No campaigns spent anything in this period.</p>
            ) : (
              <div className="p-[18px]">
                <Table head={['Campaign', 'Status', 'Type', 'Daily budget', 'Cost', 'Clicks', 'Conversions', 'Lost to budget']} min={820}>
                  {s.sync.campaigns.map((c) => (
                    <tr key={c.id}>
                      <td className="font-medium text-white/90">{c.name}</td>
                      <td className="text-white/70">{c.status.toLowerCase()}</td>
                      <td className="text-white/70">{c.channel.toLowerCase().replace(/_/g, ' ')}</td>
                      <td className="tabular-nums">
                        {money(c.budget)}
                        {c.budgetShared && <span className="text-white/50 text-xs"> (shared)</span>}
                      </td>
                      <td className="tabular-nums">{money(c.cost)}</td>
                      <td className="tabular-nums">{num(c.clicks)}</td>
                      <td className="tabular-nums">{decimals(c.conversions)}</td>
                      <td className="tabular-nums">{c.lostToBudget == null ? '—' : `${decimals(c.lostToBudget, 1)}%`}</td>
                    </tr>
                  ))}
                </Table>
              </div>
            )}
          </Card>
          {s.sync.capped.campaigns && <Note>Only the campaigns that spent the most were read; the account has more.</Note>}
        </>
      )}
    </>
  )
}

function MetricTile({ m, money }: { m: AdsMetric; money: (n: number | null) => string }) {
  let change: ReactNode = <span className="text-white/50">No earlier period to compare</span>
  if (m.previous != null && m.value != null) {
    if (m.previous === 0) change = <span className="text-white/60">was {metricValue(m, 0, money)}</span>
    else {
      const d = (m.value - m.previous) / Math.abs(m.previous)
      const flat = Math.abs(d) < 0.005
      const good = m.betterWhen === 'lower' ? d < 0 : d > 0
      change = (
        <span className={`inline-flex items-center gap-1 tabular-nums ${flat ? 'text-white/60' : good ? 'text-success' : 'text-danger'}`}>
          {!flat && (d > 0 ? <Icon.TrendUp size={12} /> : <Icon.TrendDown size={12} />)}
          {`${d > 0 ? '+' : ''}${Math.round(d * 100)}%`} <span className="text-white/50">from {metricValue(m, m.previous, money)}</span>
        </span>
      )
    }
  } else if (m.previous != null) change = <span className="text-white/60">was {metricValue(m, m.previous, money)}</span>
  return (
    <div className="kpi">
      <div className="text-[12.5px] text-white/65">{m.label}</div>
      <div className="text-[22px] font-semibold tracking-[-0.03em] leading-[1.1] mt-1.5 tabular-nums">{metricValue(m, m.value, money)}</div>
      <div className="mt-2 text-xs">{change}</div>
    </div>
  )
}

function FindingLink({ n, label, onClick }: { n: number; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-3 rounded-lg border border-hairline bg-white/[0.03] px-3 py-2.5 text-left hover:bg-white/[0.06] transition-colors">
      <span className={`text-lg font-semibold tabular-nums w-10 shrink-0 ${n ? 'text-white' : 'text-white/40'}`}>{n}</span>
      <span className="text-[13px] text-white/75 flex-1">{label}</span>
      <Icon.ChevronRight size={14} className="text-white/45" />
    </button>
  )
}

/* ------------------------------------------------------------------ Search terms */

function SearchTerms({ s, money, goTab }: TabProps) {
  const f = s.findings
  if (!s.sync || !f) return <NeedsSync s={s} goTab={goTab} />
  return (
    <>
      <p className="text-sm text-white/70 max-w-[80ch]">
        A search term is called wasted only after it spent at least one conversion’s worth (this account’s own cost per conversion,{' '}
        {money(f.kpis.cpa)}) over 5 or more clicks with no conversion. Searches for the business’s own name (brand words, in Settings) are never suggested.
      </p>
      {f.tracking && (
        <div className="glass p-3 text-sm text-danger border-danger/20">No conversions are being recorded, so no search term can be judged on results. See Overview.</div>
      )}

      <Card title={`Wasted search terms (${f.wastedTerms.length})`}>
        {f.wastedTerms.length === 0 ? (
          <p className="text-sm text-white/60">None in this period.</p>
        ) : (
          <Table head={['Search term', 'Campaign', 'Ad group', 'Cost', 'Clicks', 'Conversions’ worth']} min={720}>
            {f.wastedTerms.map((t, i) => (
              <tr key={`${t.term}-${t.campaignId}-${i}`}>
                <td className="font-medium text-white/90">{t.term}</td>
                <td className="text-white/70">{t.campaign}</td>
                <td className="text-white/70">{t.adGroup}</td>
                <td className="tabular-nums">{money(t.cost)}</td>
                <td className="tabular-nums">{num(t.clicks)}</td>
                <td className="tabular-nums">{decimals(t.timesCpa, 1)}×</td>
              </tr>
            ))}
          </Table>
        )}
        <Note>“Conversions’ worth” is how many times the account’s cost per conversion this term spent without converting. Adding them as negatives is on the Changes tab.</Note>
      </Card>

      <Card title={`Words that keep wasting (${f.negativeWords.length})`}>
        {f.negativeWords.length === 0 ? (
          <p className="text-sm text-white/60">None in this period.</p>
        ) : (
          <Table head={['Word', 'Search terms', 'Cost', 'Clicks']} min={480}>
            {f.negativeWords.map((w) => (
              <tr key={w.word}>
                <td className="font-medium text-white/90">{w.word}</td>
                <td className="tabular-nums">{num(w.terms)}</td>
                <td className="tabular-nums">{money(w.cost)}</td>
                <td className="tabular-nums">{num(w.clicks)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title={`Low Quality Score keywords (${f.lowQuality.length})`}>
        {f.lowQuality.length === 0 ? (
          <p className="text-sm text-white/60">None in this period.</p>
        ) : (
          <Table head={['Keyword', 'Ad group', 'Quality Score', 'Cost', 'Conversions']} min={560}>
            {f.lowQuality.map((k) => (
              <tr key={k.resource}>
                <td className="font-medium text-white/90">
                  {k.keyword} <span className="text-white/45 text-xs">{k.match.toLowerCase()}</span>
                </td>
                <td className="text-white/70">{k.adGroup}</td>
                <td className="tabular-nums">{k.qualityScore}/10</td>
                <td className="tabular-nums">{money(k.cost)}</td>
                <td className="tabular-nums">{decimals(k.conversions)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title={`Disapproved ads (${f.disapproved.length})`}>
        {f.disapproved.length === 0 ? (
          <p className="text-sm text-white/60">None.</p>
        ) : (
          <Table head={['Campaign', 'Ad group', 'Final URL']} min={520}>
            {f.disapproved.map((a) => (
              <tr key={a.adId}>
                <td>{a.campaign}</td>
                <td className="text-white/70">{a.adGroup}</td>
                <td className="text-white/70 break-all">{a.finalUrl || '—'}</td>
              </tr>
            ))}
          </Table>
        )}
        <Note>Google says why an ad was disapproved in Google Ads itself; open the ad there to read the policy and fix it.</Note>
      </Card>

      <Card title={`Landing pages (${f.landingPages.length})`}>
        {f.landingPages.length === 0 ? (
          <p className="text-sm text-white/60">None read.</p>
        ) : (
          <Table head={['Page', 'Cost', 'Clicks', 'Conversions']} min={520}>
            {f.landingPages.map((p) => (
              <tr key={p.url}>
                <td className="break-all">
                  <a href={p.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                    {p.url}
                  </a>
                </td>
                <td className="tabular-nums">{money(p.cost)}</td>
                <td className="tabular-nums">{num(p.clicks)}</td>
                <td className="tabular-nums">{decimals(p.conversions)}</td>
              </tr>
            ))}
          </Table>
        )}
        {s.devpilot && (
          <Note>
            This client is linked to DevPilot ({s.devpilot.projectName}), so a fix to a landing page can be done there.
          </Note>
        )}
      </Card>
      {s.sync.capped.searchTerms && <Note>Only the costliest search terms were read; cheaper ones are not judged here.</Note>}
    </>
  )
}

/* ------------------------------------------------------------------ Changes */

function proposalText(p: AdsProposal, s: AdsState, money: (n: number | null | undefined) => string) {
  if (p.kind === 'add_negative') {
    const campaign = p.campaign || s.sync?.campaigns.find((c) => c.id === p.campaignId)?.name || `campaign ${p.campaignId}`
    return `Add "${p.text}" as a ${(p.match || '').toLowerCase()} negative on campaign ${campaign}`
  }
  if (p.kind === 'set_budget') return `Change the daily budget of ${p.campaign || 'a campaign'} from ${money(p.from)} to ${money(p.to)}`
  return `Pause the keyword "${p.keyword}"${p.adGroup ? ` in ad group ${p.adGroup}` : ''}`
}

function Changes({ projectId, s, setS, money }: TabProps) {
  const [dialog, setDialog] = useState<null | { kind: 'allow' } | { kind: 'apply'; p: AdsProposal } | { kind: 'undo'; id: string; summary: string }>(null)
  const [understood, setUnderstood] = useState(false)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [dialogErr, setDialogErr] = useState('')
  const [note, setNote] = useState('')
  const [budgets, setBudgets] = useState<Record<string, string>>({})

  const writes = !!s.connection?.writesAllowed
  const open = s.proposals.filter((p) => p.status === 'open')
  const writesOffWhy = !s.connection
    ? 'Connect Google Ads first.'
    : !s.connection.account
      ? 'Pick the Google Ads account first.'
      : 'Changes are not allowed for this account yet (see above).'

  const close = () => {
    setDialog(null)
    setDialogErr('')
    setUnderstood(false)
  }

  const inDialog = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    setDialogErr('')
    try {
      await fn()
      close()
    } catch (e: any) {
      setDialogErr(e.message)
    } finally {
      setBusy('')
    }
  }

  const switchOff = async () => {
    setBusy('off')
    setErr('')
    setNote('')
    try {
      setS(await api.adsWrites(projectId, false))
      setNote('Changes are switched off. AdsPilot only reads and suggests now.')
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy('')
    }
  }

  const dismiss = async (p: AdsProposal) => {
    setBusy(p.id)
    setErr('')
    setNote('')
    try {
      setS(await api.adsDismiss(projectId, p.id))
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy('')
    }
  }

  // The budget a person may type: only lower than (or equal to) the suggestion, and above zero.
  const budgetFor = (p: AdsProposal) => {
    const raw = budgets[p.id]
    if (raw === undefined || raw === '') return { to: p.to, ok: true, why: '' }
    const v = Number(raw)
    if (!Number.isFinite(v) || v <= 0) return { to: undefined, ok: false, why: 'Enter a budget above zero.' }
    if (p.to != null && v > p.to) return { to: undefined, ok: false, why: `It can only be lowered from the suggested ${money(p.to)}.` }
    return { to: v, ok: true, why: '' }
  }

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h3 className="panel-title">
            Changes to this Google Ads account
            {writes ? <span className="pill pill-watch">Allowed</span> : <span className="pill pill-muted">Read-only</span>}
          </h3>
          {s.setup.canAllowWrites && s.connection?.account && (
            <div className="shrink-0">
              {writes ? (
                <button className="btn-secondary h-8 px-3 text-xs disabled:opacity-40" disabled={!!busy} onClick={() => void switchOff()}>
                  {busy === 'off' ? 'Switching off…' : 'Switch off'}
                </button>
              ) : (
                <button className="btn-primary h-8 px-3 text-xs" disabled={!!busy} onClick={() => setDialog({ kind: 'allow' })}>
                  Allow changes
                </button>
              )}
            </div>
          )}
        </div>
        <div className="panel-body text-sm text-white/75 space-y-2 leading-relaxed">
          {writes ? (
            <p>
              AdsPilot may make the changes you approve below, one at a time, on {s.connection?.accountName || s.connection?.account}
              {s.connection?.writesAllowedBy ? ` (allowed by ${s.connection.writesAllowedBy})` : ''}. Nothing changes without your Apply, and each change can be undone.
            </p>
          ) : (
            <p>AdsPilot only reads and suggests until a workspace owner or admin allows changes. Google’s permission cannot be read-only, so this switch is the read-only lock.</p>
          )}
          {!s.setup.canAllowWrites && <p className="text-xs text-white/55">Only a workspace owner or admin can switch this.</p>}
          {s.setup.canAllowWrites && !s.connection?.account && <p className="text-xs text-white/55">{writesOffWhy}</p>}
          <p className="text-xs text-white/55">Choosing a different account in the connection card switches changes off again: a permission given for one account does not follow the client to another.</p>
        </div>
      </section>
      <Err text={err} />
      {note && <div className="glass p-3 text-sm text-success">{note}</div>}

      <Card title={`Suggested changes (${open.length})`}>
        {open.length === 0 ? (
          <p className="text-sm text-white/60">{s.sync ? 'Nothing to suggest from the last sync.' : 'Suggestions appear after the first sync.'}</p>
        ) : (
          <div className="space-y-2">
            {open.map((p) => {
              const b = p.kind === 'set_budget' ? budgetFor(p) : null
              return (
                <div key={p.id} className="rounded-lg border border-hairline bg-white/[0.03] p-3 text-[13px] space-y-2">
                  <div className="font-medium text-white/90">{proposalText(p, s, money)}</div>
                  <div className="text-xs text-white/60">{p.reason}</div>
                  {p.kind === 'set_budget' && (
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <label htmlFor={`budget-${p.id}`} className="text-white/70">
                        New daily budget
                      </label>
                      <input
                        id={`budget-${p.id}`}
                        className="input h-8 w-32 text-xs"
                        type="number"
                        min={0}
                        step="0.01"
                        max={p.to}
                        placeholder={String(p.to ?? '')}
                        value={budgets[p.id] ?? ''}
                        onChange={(e) => setBudgets((x) => ({ ...x, [p.id]: e.target.value }))}
                      />
                      <span className="text-white/50">
                        You can lower it, not raise it. One change moves a budget by at most {s.limits.budgetMaxStepPercent}%.
                      </span>
                      {b && !b.ok && <span className="text-danger w-full">{b.why}</span>}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      className="btn-primary h-8 px-3 text-xs disabled:opacity-40"
                      disabled={!writes || !!busy || (b !== null && !b.ok)}
                      title={!writes ? writesOffWhy : undefined}
                      onClick={() => setDialog({ kind: 'apply', p })}
                    >
                      Apply
                    </button>
                    <button className="btn-ghost h-8 px-3 text-xs disabled:opacity-40" disabled={!!busy} onClick={() => void dismiss(p)}>
                      {busy === p.id ? '…' : 'Dismiss'}
                    </button>
                    {!writes && <span className="text-xs text-white/50">{writesOffWhy}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <Note>A suggestion the next sync no longer supports is dropped, so what you approve is what today’s data argues for.</Note>
      </Card>

      <Card title="Changes made">
        {s.journal.length === 0 ? (
          <p className="text-sm text-white/60">No change has been made through AdsPilot yet.</p>
        ) : (
          <div className="space-y-2">
            {s.journal.map((j) => (
              <div key={j.id} className="rounded-lg border border-hairline bg-white/[0.03] p-3 text-[13px] space-y-1.5">
                <div className="font-medium text-white/90">{j.summary}</div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-white/55">
                  <span>
                    {when(j.applied_at)}
                    {j.applied_by ? ` by ${j.applied_by}` : ''}
                  </span>
                  {j.verified ? (
                    <span className="pill pill-good">
                      <Icon.Check size={11} /> Verified in Google Ads
                    </span>
                  ) : (
                    <span className="pill pill-watch">
                      <Icon.AlertTriangle size={11} /> Not verified — check it in Google Ads
                    </span>
                  )}
                </div>
                {j.undone_at ? (
                  <div className="text-xs text-white/60">
                    Undone {when(j.undone_at)}
                    {j.undone_by ? ` by ${j.undone_by}` : ''}.{' '}
                    {j.undo_verified ? <span className="text-success">The undo was verified in Google Ads.</span> : <span className="text-warning">The undo was not verified — check it in Google Ads.</span>}
                  </div>
                ) : (
                  <button className="btn-secondary h-8 px-3 text-xs disabled:opacity-40" disabled={!!busy} onClick={() => setDialog({ kind: 'undo', id: j.id, summary: j.summary })}>
                    Undo
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {dialog?.kind === 'allow' && (
        <Confirm
          title="Allow AdsPilot to change this account?"
          confirmLabel="Allow changes"
          busy={busy === 'allow'}
          ready={understood}
          error={dialogErr}
          onClose={close}
          onConfirm={() =>
            void inDialog('allow', async () => {
              setS(await api.adsWrites(projectId, true))
              setNote('Changes are allowed. Each one still waits for your Apply.')
            })
          }
        >
          <p>
            This lets AdsPilot make changes on <b>{s.connection?.accountName || s.connection?.account}</b> — only the ones you approve here, one at a time. You can switch it off at any time.
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
            <span>I understand AdsPilot will change this Google Ads account when I approve a change</span>
          </label>
        </Confirm>
      )}
      {dialog?.kind === 'apply' && (
        <Confirm
          title="Apply this change in Google Ads?"
          confirmLabel="Apply"
          busy={busy === 'apply'}
          error={dialogErr}
          onClose={close}
          onConfirm={() =>
            void inDialog('apply', async () => {
              const p = dialog.p
              const to = p.kind === 'set_budget' ? budgetFor(p).to : undefined
              const r = await api.adsApply(projectId, p.id, to)
              setS(r.state)
              setNote(r.entry.verified ? `${r.entry.summary} Verified in Google Ads.` : `${r.entry.summary} It could not be verified — check it in Google Ads.`)
            })
          }
        >
          <p className="font-medium">
            {dialog.p.kind === 'set_budget'
              ? `Change the daily budget of ${dialog.p.campaign || 'a campaign'} from ${money(dialog.p.from)} to ${money(budgetFor(dialog.p).to)}`
              : proposalText(dialog.p, s, money)}
          </p>
          <p className="text-white/65">This is written to the live Google Ads account now, then read back to check it landed. You can undo it afterwards from Changes made.</p>
        </Confirm>
      )}
      {dialog?.kind === 'undo' && (
        <Confirm
          title="Undo this change?"
          confirmLabel="Undo"
          busy={busy === 'undo'}
          error={dialogErr}
          onClose={close}
          onConfirm={() =>
            void inDialog('undo', async () => {
              const r = await api.adsUndo(projectId, dialog.id)
              setS(r.state)
              setNote(r.result.verified ? `${r.result.summary} Verified in Google Ads.` : `${r.result.summary} It could not be verified — check it in Google Ads.`)
            })
          }
        >
          <p className="font-medium">{dialog.summary}</p>
          <p className="text-white/65">AdsPilot puts it back the way it was before, in the live account, and reads it back to check.</p>
        </Confirm>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ Ad copy */

type Line = { text: string; on: boolean }
const toLines = (xs: string[]): Line[] => xs.map((text) => ({ text, on: true }))

function AdCopy({ projectId, s, setS, goTab }: TabProps) {
  const weak = s.findings?.weakAds || []
  // Ad groups with a draft already, even if the newest sync no longer calls their ad weak.
  const groups = useMemo(() => {
    const m = new Map<string, { adGroupId: string; adGroup: string; campaign: string; impressions: number | null }>()
    for (const a of weak) if (!m.has(a.adGroupId)) m.set(a.adGroupId, { adGroupId: a.adGroupId, adGroup: a.adGroup, campaign: a.campaign, impressions: a.impressions })
    for (const d of Object.values(s.drafts || {})) if (!m.has(d.adGroupId)) m.set(d.adGroupId, { adGroupId: d.adGroupId, adGroup: d.adGroup, campaign: d.campaign, impressions: null })
    return [...m.values()]
  }, [weak, s.drafts])

  const [group, setGroup] = useState('')
  const [draft, setDraft] = useState<AdsDraft | null>(null)
  const [heads, setHeads] = useState<Line[]>([])
  const [descs, setDescs] = useState<Line[]>([])
  const [finalUrl, setFinalUrl] = useState('')
  const [path1, setPath1] = useState('')
  const [path2, setPath2] = useState('')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [dialogErr, setDialogErr] = useState('')

  const load = (d: AdsDraft | null) => {
    setDraft(d)
    setHeads(toLines(d?.headlines || []))
    setDescs(toLines(d?.descriptions || []))
    setFinalUrl(d?.finalUrl || '')
    setPath1('')
    setPath2('')
  }
  const choose = (id: string) => {
    setGroup(id)
    setErr('')
    setNote('')
    load(s.drafts?.[id] || null)
  }

  if (!s.sync) return <NeedsSync s={s} goTab={goTab} />

  const lim = s.limits.rsa
  const writes = !!s.connection?.writesAllowed
  const chosenH = heads.filter((l) => l.on)
  const chosenD = descs.filter((l) => l.on)
  const problems: string[] = []
  if (chosenH.length < 3 || chosenH.length > 15) problems.push(`Choose 3 to 15 headlines (${chosenH.length} chosen).`)
  if (chosenD.length < 2 || chosenD.length > 4) problems.push(`Choose 2 to 4 descriptions (${chosenD.length} chosen).`)
  if (chosenH.some((l) => !l.text.trim() || l.text.length > lim.headline)) problems.push(`Every chosen headline must have text and fit in ${lim.headline} characters.`)
  if (chosenD.some((l) => !l.text.trim() || l.text.length > lim.description)) problems.push(`Every chosen description must have text and fit in ${lim.description} characters.`)
  if (!/^https?:\/\/\S+$/i.test(finalUrl.trim())) problems.push('Enter the final URL, starting with https://.')
  if (path1.length > lim.path || path2.length > lim.path) problems.push(`Each path fits in ${lim.path} characters.`)
  if (path2 && !path1) problems.push('Path 2 needs a path 1.')
  const createWhy = !writes ? 'Changes are not allowed for this account yet: a workspace owner or admin allows them on the Changes tab.' : problems[0] || ''

  const generate = async () => {
    setBusy('draft')
    setErr('')
    setNote('')
    try {
      const r = await api.adsCopy(projectId, group)
      load(r.draft)
      setS({ ...s, drafts: { ...s.drafts, [group]: r.draft } })
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy('')
    }
  }

  const create = async () => {
    setBusy('create')
    setDialogErr('')
    try {
      const r = await api.adsCreateAd(projectId, {
        adGroupId: group,
        headlines: chosenH.map((l) => l.text.trim()),
        descriptions: chosenD.map((l) => l.text.trim()),
        finalUrl: finalUrl.trim(),
        path1: path1.trim(),
        path2: path2.trim(),
      })
      setS(r.state)
      setConfirm(false)
      setNote(r.entry.verified ? `${r.entry.summary}` : `${r.entry.summary} It could not be verified — check it in Google Ads.`)
    } catch (e: any) {
      setDialogErr(e.message)
    } finally {
      setBusy('')
    }
  }

  const current = groups.find((g) => g.adGroupId === group)

  return (
    <>
      <Card title={`Ads with few headlines or descriptions (${weak.length})`}>
        {weak.length === 0 ? (
          <p className="text-sm text-white/60">None in the last sync. New copy can only be drafted for an ad group listed here.</p>
        ) : (
          <Table head={['Ad group', 'Campaign', 'Impressions', 'Headlines', 'Descriptions']} min={560}>
            {weak.map((a) => (
              <tr key={a.adId}>
                <td className="font-medium text-white/90">{a.adGroup}</td>
                <td className="text-white/70">{a.campaign}</td>
                <td className="tabular-nums">{num(a.impressions)}</td>
                <td className="tabular-nums">{a.headlines.length}</td>
                <td className="tabular-nums">{a.descriptions.length}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {groups.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h3 className="panel-title">Draft new copy</h3>
          </div>
          <div className="panel-body space-y-3 text-sm">
            <div className="flex flex-wrap gap-2 items-center">
              <select className="input h-9 text-xs w-auto min-w-[240px]" value={group} aria-label="Ad group" onChange={(e) => choose(e.target.value)}>
                <option value="">Choose an ad group…</option>
                {groups.map((g) => (
                  <option key={g.adGroupId} value={g.adGroupId}>
                    {g.adGroup} — {g.campaign}
                  </option>
                ))}
              </select>
              <button className="btn-primary h-9 px-3 text-xs disabled:opacity-40" disabled={!group || !!busy} title={!group ? 'Choose an ad group first.' : undefined} onClick={() => void generate()}>
                <Icon.Sparkles size={13} /> {busy === 'draft' ? 'Writing…' : draft ? 'Draft again' : 'Draft new copy'}
              </button>
            </div>
            <p className="text-xs text-white/55 leading-relaxed">
              The AI may only use the business facts written in{' '}
              <button className="text-accent hover:underline" onClick={() => goTab('settings')}>
                Settings
              </button>
              {s.settings.businessFacts.trim() ? '' : ' (none are written yet, so it can only describe what the ad group is about)'}. Drafting writes nothing to Google Ads.
            </p>
            <Err text={err} />
            {note && <div className="glass p-3 text-sm text-success">{note}</div>}

            {draft && current && (
              <div className="space-y-4">
                <div className="text-xs text-white/55">
                  Drafted {when(draft.at)} for {draft.adGroup} ({draft.campaign}).
                  {!draft.enough && <span className="text-warning"> There were not enough usable lines for a full ad; add your own below.</span>}
                </div>
                <LineEditor title="Headlines" lines={heads} setLines={setHeads} max={lim.headline} range="3–15" />
                <LineEditor title="Descriptions" lines={descs} setLines={setDescs} max={lim.description} range="2–4" />

                {draft.dropped.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-white/80 mb-1">Left out</div>
                    <ul className="space-y-1 text-xs">
                      {draft.dropped.map((d, i) => (
                        <li key={i} className="text-white/60">
                          <span className="text-white/80">“{d.text}”</span> — {d.why}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="grid sm:grid-cols-[1fr_auto_auto] gap-2 items-end">
                  <div>
                    <label htmlFor="ads-final-url" className="block text-xs text-white/70 mb-1">
                      Final URL
                    </label>
                    <input id="ads-final-url" className="input h-9 text-xs" value={finalUrl} onChange={(e) => setFinalUrl(e.target.value)} placeholder="https://" />
                  </div>
                  <PathInput id="ads-path1" label="Path 1 (optional)" value={path1} set={setPath1} max={lim.path} />
                  <PathInput id="ads-path2" label="Path 2 (optional)" value={path2} set={setPath2} max={lim.path} />
                </div>

                {problems.length > 0 && (
                  <ul className="text-xs text-danger space-y-0.5">
                    {problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <button className="btn-primary h-9 px-3 text-xs disabled:opacity-40" disabled={!!createWhy || !!busy} title={createWhy || undefined} onClick={() => setConfirm(true)}>
                    Create as a paused ad
                  </button>
                  {!writes && <span className="text-xs text-white/55">{createWhy}</span>}
                </div>
                <Note>The ad is created PAUSED and spends nothing until someone switches it on in Google Ads. It can be removed again from Changes made.</Note>
              </div>
            )}
          </div>
        </section>
      )}

      {confirm && (
        <Confirm title="Create this ad in Google Ads?" confirmLabel="Create paused ad" busy={busy === 'create'} error={dialogErr} onClose={() => (setConfirm(false), setDialogErr(''))} onConfirm={() => void create()}>
          <p>
            A new responsive search ad with {chosenH.length} headlines and {chosenD.length} descriptions goes into <b>{current?.adGroup}</b>, paused. It spends nothing until it is switched on in Google Ads.
          </p>
        </Confirm>
      )}
    </>
  )
}

function LineEditor({ title, lines, setLines, max, range }: { title: string; lines: Line[]; setLines: (l: Line[]) => void; max: number; range: string }) {
  const set = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const chosen = lines.filter((l) => l.on).length
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="text-xs font-medium text-white/80">
          {title} <span className="text-white/50 font-normal">· {chosen} chosen, {range} allowed, up to {max} characters each</span>
        </div>
        <button className="text-xs text-accent hover:underline disabled:opacity-40" disabled={lines.length >= 15} onClick={() => setLines([...lines, { text: '', on: true }])}>
          <Icon.Plus size={11} className="inline" /> Add a line
        </button>
      </div>
      <div className="space-y-1.5">
        {lines.length === 0 && <p className="text-xs text-white/50">None drafted.</p>}
        {lines.map((l, i) => {
          const over = l.text.length > max
          return (
            <div key={i} className="flex items-center gap-2">
              <input type="checkbox" checked={l.on} aria-label={`Use this ${title.toLowerCase().slice(0, -1)}`} onChange={(e) => set(i, { on: e.target.checked })} />
              <input className={`input h-8 text-xs flex-1 ${over ? 'border-danger/60' : ''}`} value={l.text} onChange={(e) => set(i, { text: e.target.value })} />
              <span className={`text-[11px] tabular-nums w-12 text-right ${over ? 'text-danger font-semibold' : 'text-white/50'}`}>
                {l.text.length}/{max}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PathInput({ id, label, value, set, max }: { id: string; label: string; value: string; set: (v: string) => void; max: number }) {
  const over = value.length > max
  return (
    <div>
      <label htmlFor={id} className="block text-xs text-white/70 mb-1">
        {label} <span className={over ? 'text-danger font-semibold' : 'text-white/45'}>{value.length}/{max}</span>
      </label>
      <input id={id} className={`input h-9 text-xs w-36 ${over ? 'border-danger/60' : ''}`} value={value} onChange={(e) => set(e.target.value.replace(/\s|\//g, ''))} />
    </div>
  )
}

/* ------------------------------------------------------------------ Ask */

function Ask({ projectId, s, setS, goTab }: TabProps) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [s.thread.length])

  if (!s.sync) return <NeedsSync s={s} goTab={goTab} />
  const syncAt = s.sync.at

  const ask = async () => {
    const question = q.trim()
    if (!question) return
    setBusy(true)
    setErr('')
    try {
      await api.adsAsk(projectId, question)
      setQ('')
      // The server is the thread: read it back rather than appending what came back.
      setS(await api.adsState(projectId))
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <p className="text-sm text-white/70">Answers come from the last sync only ({timeAgo(syncAt)}), and every figure is checked against it. Nothing is read live from Google Ads.</p>
      <div className="space-y-3">
        {s.thread.length === 0 && <div className="glass p-4 text-sm text-white/60">No questions yet. Try “Where is the money going with nothing to show for it?”</div>}
        {s.thread.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl bg-accent/[0.14] px-4 py-2.5 text-sm whitespace-pre-wrap break-words">{m.content}</div>
            </div>
          ) : (
            <div key={i} className="glass p-4">
              {!!m.unsupported?.length && (
                <div role="alert" className="mb-3 p-3 rounded-xl bg-warning/10 border border-warning/30 text-xs flex gap-2.5">
                  <Icon.AlertTriangle size={14} className="shrink-0 mt-0.5 text-warning" />
                  <div className="min-w-0 text-white/75 leading-relaxed">
                    <span className="font-semibold text-warning">These figures are not in the synced data: </span>
                    {m.unsupported.map((u, j) => (
                      <code key={j} className="font-mono text-[11.5px] font-semibold text-white bg-white/[0.08] rounded px-1.5 py-px mr-1">
                        {u}
                      </code>
                    ))}
                    Check them before using them.
                  </div>
                </div>
              )}
              <RichText className="text-sm" text={m.content} />
              <div className="mt-3 pt-2.5 border-t border-hairline flex flex-wrap items-center gap-2.5 text-xs text-white/50">
                {m.unsupported?.length ? <span className="pill-watch">{m.unsupported.length} figure{m.unsupported.length === 1 ? '' : 's'} unverified</span> : <span className="pill-good">Every figure checked</span>}
                {m.sync_at && m.sync_at !== syncAt ? <span className="text-warning/90">Answered from an earlier sync. Ask again to use the latest one.</span> : <span>{when(m.at)}</span>}
              </div>
            </div>
          ),
        )}
        <div ref={end} />
      </div>
      <Err text={err} />
      <div className="flex gap-2">
        <label htmlFor="ads-q" className="sr-only">
          Your question
        </label>
        <textarea
          id="ads-q"
          className="input flex-1 h-20 py-2 leading-relaxed"
          maxLength={1000}
          placeholder="Ask about this Google Ads account…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void ask()
            }
          }}
        />
        <button className="btn-primary self-end disabled:opacity-40" disabled={busy || !q.trim()} onClick={() => void ask()}>
          <Icon.Send size={14} /> {busy ? 'Thinking…' : 'Ask'}
        </button>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ Settings */

function AdsSettings({ projectId, s, setS, money }: TabProps) {
  const [facts, setFacts] = useState(s.settings.businessFacts)
  const [brand, setBrand] = useState(s.settings.brandWords)
  const [ceiling, setCeiling] = useState(s.settings.maxDailyBudget == null ? '' : String(s.settings.maxDailyBudget))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')

  const ceilingBad = ceiling.trim() !== '' && !(Number(ceiling) > 0)
  const dirty = facts !== s.settings.businessFacts || brand !== s.settings.brandWords || ceiling !== (s.settings.maxDailyBudget == null ? '' : String(s.settings.maxDailyBudget))

  const save = async () => {
    setBusy(true)
    setErr('')
    setNote('')
    try {
      const r = await api.adsSettings(projectId, { businessFacts: facts, brandWords: brand, maxDailyBudget: ceiling.trim() === '' ? null : Number(ceiling) })
      setS(r)
      setNote('Saved. Brand words and the budget ceiling apply from the next sync.')
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Card title="Google Ads account">
        {s.connection ? (
          <div className="text-sm text-white/75 space-y-1">
            <p>Signed in as {s.connection.email || 'an unknown Google account'}.</p>
            <p>{s.connection.account ? `Reading ${s.connection.accountName || s.connection.account}.` : 'No account chosen yet.'}</p>
            <p className="text-xs text-white/55">
              Change the account in the <ConnLink>Google Ads connection</ConnLink> card at the top of this page. Choosing another account switches changes off
              again.
            </p>
          </div>
        ) : (
          <p className="text-sm text-white/65">
            Not connected. Use <ConnLink>Connect Google Ads</ConnLink> at the top of this page.
          </p>
        )}
      </Card>

      <section className="panel">
        <div className="panel-head">
          <h3 className="panel-title">AdsPilot settings</h3>
        </div>
        <div className="panel-body space-y-4 text-sm">
          <div>
            <label htmlFor="ads-facts" className="block text-xs font-medium text-white/80 mb-1">
              Business facts
            </label>
            <textarea id="ads-facts" className="input h-32 py-2 leading-relaxed" maxLength={2000} value={facts} onChange={(e) => setFacts(e.target.value)} />
            <p className="text-[11.5px] text-white/55 mt-1 leading-relaxed">
              Used by Ad copy, and the only claims the AI may make — prices, offers, years and awards only if they are written here. {facts.length}/2000
            </p>
          </div>
          <div>
            <label htmlFor="ads-brand" className="block text-xs font-medium text-white/80 mb-1">
              Brand words
            </label>
            <input id="ads-brand" className="input h-9 text-xs" maxLength={300} value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="acme, acme plumbing" />
            <p className="text-[11.5px] text-white/55 mt-1">Comma separated. A search containing one is never suggested as a negative. The client’s name counts already.</p>
          </div>
          <div>
            <label htmlFor="ads-ceiling" className="block text-xs font-medium text-white/80 mb-1">
              Daily budget ceiling
            </label>
            <input id="ads-ceiling" className="input h-9 text-xs w-40" type="number" min={0} step="0.01" value={ceiling} onChange={(e) => setCeiling(e.target.value)} placeholder="No ceiling" />
            <p className="text-[11.5px] text-white/55 mt-1">
              No suggested or applied daily budget goes above this{ceiling.trim() && !ceilingBad ? ` (${money(Number(ceiling))})` : ''}. Leave empty for none.
            </p>
            {ceilingBad && <p className="text-xs text-danger mt-1">The ceiling must be a positive number, or empty for none.</p>}
          </div>
          <Err text={err} />
          {note && <p className="text-xs text-success">{note}</p>}
          <button className="btn-primary disabled:opacity-40" disabled={busy || !dirty || ceilingBad} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </section>
    </>
  )
}
