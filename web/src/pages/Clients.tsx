// Clients: one card per Google Ads account the agency runs. The API calls them projects.
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icons'
import { Empty, Err, Loading, PageHead } from '../components/Bits'
import { api } from '../lib/api'
import type { Alert, Client } from '../lib/types'

export function Clients() {
  const [clients, setClients] = useState<Client[] | null>(null)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [err, setErr] = useState('')
  const [name, setName] = useState('')
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [addErr, setAddErr] = useState('')
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()

  // The OAuth callback lands here (not on a client page) only when the sign-in link had expired.
  const googleMsg = params.get('google') === 'error' ? params.get('reason') || 'Google sign-in did not finish.' : ''

  useEffect(() => {
    api
      .clients()
      .then((r) => setClients(r.projects))
      .catch((e) => setErr(e.message))
    api
      .alerts()
      .then((r) => setAlerts(r.alerts))
      .catch(() => {})
  }, [])

  const add = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setAddErr('')
    try {
      const r = await api.addClient(name.trim())
      navigate(`/app/accounts/${r.project.id}`)
    } catch (e: any) {
      setAddErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const openAlerts = (id: string) => alerts.filter((a) => a.project_id === id && a.status === 'open').length

  return (
    <div className="space-y-5 animate-fadeIn">
      <PageHead
        title="Clients"
        blurb="Each client is one Google Ads account. AdsPilot reads it, finds the spend with nothing to show for it, and suggests changes you approve one at a time."
        right={
          !adding && (
            <button className="btn-primary" onClick={() => setAdding(true)}>
              <Icon.Plus size={14} /> Add client
            </button>
          )
        }
      />
      {googleMsg && (
        <div className="glass p-3 text-sm text-danger border-danger/20 flex items-start justify-between gap-3">
          <span>{googleMsg}</span>
          <button className="btn-ghost h-7 w-7 p-0" aria-label="Dismiss" onClick={() => setParams({})}>
            <Icon.X size={13} />
          </button>
        </div>
      )}

      {adding && (
        <form onSubmit={add} className="glass p-4 flex flex-wrap items-center gap-2">
          <label htmlFor="client-name" className="text-sm text-white/80">
            Client name
          </label>
          <input id="client-name" className="input h-9 w-auto flex-1 min-w-[220px]" autoFocus placeholder="Acme Plumbing" value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="btn-primary" disabled={busy || !name.trim()}>
            {busy ? 'Adding…' : 'Add'}
          </button>
          <button type="button" className="btn-ghost" onClick={() => (setAdding(false), setAddErr(''))}>
            Cancel
          </button>
          {addErr && <p className="w-full text-xs text-danger">{addErr}</p>}
        </form>
      )}

      <Err text={err} />
      {!clients ? (
        !err && <Loading rows={2} />
      ) : clients.length === 0 ? (
        <Empty
          icon={Icon.Projects}
          title="No clients yet"
          body="Add a client, then connect its Google Ads account with the Google sign-in of someone who can open it."
          action={
            !adding && (
              <button className="btn-primary" onClick={() => setAdding(true)}>
                <Icon.Plus size={14} /> Add client
              </button>
            )
          }
        />
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {clients.map((c) => {
            const n = openAlerts(c.id)
            return (
              <Link key={c.id} to={`/app/accounts/${c.id}`} className="glass glass-hover p-4 block">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{c.name}</div>
                    <div className="text-xs text-white/60 mt-1 truncate">
                      {!c.connected ? 'Google Ads not connected' : c.account ? c.accountName || `Account ${c.account}` : 'Connected — no account chosen yet'}
                    </div>
                  </div>
                  <Icon.ChevronRight size={16} className="text-white/40 shrink-0 mt-0.5" />
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-3">
                  {c.connected ? (
                    <span className="pill-good">
                      <Icon.Check size={11} /> Google connected
                    </span>
                  ) : (
                    <span className="pill-muted">Not connected</span>
                  )}
                  {c.connected && c.account && (c.writesAllowed ? <span className="pill-watch">Changes allowed</span> : <span className="pill-muted">Read-only</span>)}
                  {n > 0 ? (
                    <span className="pill-risk">
                      <Icon.AlertTriangle size={11} /> {n} open alert{n === 1 ? '' : 's'}
                    </span>
                  ) : (
                    <span className="text-[11.5px] text-white/50">No open alerts</span>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
