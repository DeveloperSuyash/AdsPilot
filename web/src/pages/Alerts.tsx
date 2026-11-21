// Alerts: incidents raised by a sync. An alert is an event: acknowledging it says somebody looked, and only the data resolves it.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icons'
import { Empty, Err, Loading, PageHead } from '../components/Bits'
import { api } from '../lib/api'
import { timeAgo } from '../lib/format'
import { useClients } from '../lib/useClients'
import type { Alert } from '../lib/types'

export function Alerts() {
  const [data, setData] = useState<{ alerts: Alert[]; emailOn: boolean; whyNoEmail: string } | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const { nameOf } = useClients()

  useEffect(() => {
    api.alerts().then(setData).catch((e) => setErr(e.message))
  }, [])

  const ack = async (id: string) => {
    setBusy(id)
    setErr('')
    try {
      const r = await api.ackAlert(id)
      setData((d) => (d ? { ...d, alerts: d.alerts.map((a) => (a.id === id ? r.alert : a)) } : d))
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy('')
    }
  }

  const sorted = data ? [...data.alerts].sort((a, b) => (a.status === b.status ? Date.parse(b.raised_at) - Date.parse(a.raised_at) : a.status === 'open' ? -1 : 1)) : []

  return (
    <div className="space-y-5 animate-fadeIn">
      <PageHead title="Alerts" blurb="Something changed sharply in a client's account: spend jumped, conversions stopped, cost per conversion rose. Open ones first." />
      {data && !data.emailOn && (
        <div className="glass p-3 text-sm text-warning border-warning/30 flex items-start gap-2.5">
          <Icon.AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>
            Alerts are not being emailed: {data.whyNoEmail || 'email is not set up on this install.'} They are listed here only, and nothing is queued to send later.
          </span>
        </div>
      )}
      <Err text={err} />
      {!data ? (
        !err && <Loading rows={2} />
      ) : sorted.length === 0 ? (
        <Empty icon={Icon.Bell} title="No alerts" body="Nothing has been raised. An alert appears here when a sync finds a sharp change in a client's account." />
      ) : (
        <section className="panel">
          {sorted.map((a) => (
            <div key={a.id} className="prow">
              <span className={`rail ${a.status !== 'open' ? 'rail-done' : a.severity === 'critical' ? 'rail-high' : 'rail-medium'}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={a.severity === 'critical' ? 'pill-risk' : 'pill-watch'}>{a.severity}</span>
                  {a.status === 'resolved' && <span className="pill-muted">Resolved</span>}
                  {a.acknowledged_at && a.status === 'open' && <span className="pill-muted">Acknowledged</span>}
                  <span className="font-medium text-white/95">{a.title}</span>
                </div>
                {a.detail && <p className="text-[13px] text-white/70 mt-1 leading-relaxed">{a.detail}</p>}
                <div className="text-xs text-white/50 mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                  <Link to={`/app/accounts/${a.project_id}`} className="text-accent hover:underline">
                    {nameOf(a.project_id)}
                  </Link>
                  <span>Raised {timeAgo(a.raised_at)}</span>
                  {a.occurrences > 1 && <span>{a.occurrences} times so far</span>}
                  <span>{a.notified_at ? `Emailed ${timeAgo(a.notified_at)}` : 'Not emailed'}</span>
                </div>
              </div>
              {a.status === 'open' && !a.acknowledged_at && (
                <button className="btn-secondary h-8 px-3 text-xs self-start shrink-0" disabled={!!busy} onClick={() => void ack(a.id)}>
                  {busy === a.id ? '…' : 'Acknowledge'}
                </button>
              )}
            </div>
          ))}
        </section>
      )}
      {data && sorted.length > 0 && <p className="text-[11.5px] text-white/50">Acknowledging does not resolve an alert; it resolves when the next sync no longer finds the problem.</p>}
    </div>
  )
}
