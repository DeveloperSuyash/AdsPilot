// One client: its name, its Google Ads connection, and the six Ads tabs. The Ads view is read ONCE here and shared by the
// connection card and every tab, so they cannot disagree about which account is chosen or whether changes are allowed.
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icons'
import { Err, Loading } from '../components/Bits'
import { AdsPilot } from '../components/AdsPilot'
import { api } from '../lib/api'
import { canManage, useSession } from '../lib/session'
import type { AdsState, Client } from '../lib/types'

const VIEWS = [
  { id: 'overview', label: 'Overview', blurb: 'What the last sync read from this client’s Google Ads account, and what it found. AdsPilot only reads and suggests until changes are allowed.' },
  { id: 'terms', label: 'Search terms', blurb: 'Searches that spent money with no conversion, the words they share, low-quality keywords, disapproved ads and landing pages.' },
  { id: 'changes', label: 'Changes', blurb: 'Suggested changes you approve one at a time, the switch that allows them, and every change made with a way to undo it.' },
  { id: 'copy', label: 'Ad copy', blurb: 'New headlines and descriptions for ads that have too few, held to Google’s limits. A created ad is paused until you switch it on.' },
  { id: 'ask', label: 'Ask', blurb: 'Questions about the account, answered from the last sync, with every figure checked against it.' },
  { id: 'settings', label: 'Settings', blurb: 'The business facts ad copy may use, brand words that are never suggested as negatives, and a daily budget ceiling.' },
]

export function ClientPage() {
  const { id = '' } = useParams()
  const auth = useSession()
  const manager = canManage(auth)
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [client, setClient] = useState<Client | null>(null)
  const [s, setS] = useState<AdsState | null>(null)
  const [err, setErr] = useState('')
  // The message from the Google sign-in, read once from the address and then taken out of it so a reload does not repeat it.
  const [google, setGoogle] = useState<{ kind: string; reason: string } | null>(null)

  const view = VIEWS.find((v) => v.id === params.get('view'))?.id ?? 'overview'
  const current = VIEWS.find((v) => v.id === view)!

  useEffect(() => {
    const g = params.get('google')
    if (g) {
      setGoogle({ kind: g, reason: params.get('reason') || '' })
      const next = new URLSearchParams(params)
      next.delete('google')
      next.delete('reason')
      setParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const reload = () => api.adsState(id).then(setS)

  useEffect(() => {
    setS(null)
    setClient(null)
    setErr('')
    api
      .clients()
      .then((r) => {
        const c = r.projects.find((p) => p.id === id) || null
        setClient(c)
        if (!c) setErr('There is no such client in this workspace.')
      })
      .catch((e) => setErr(e.message))
    reload().catch((e) => setErr(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const goTab = (v: string) => setParams({ view: v })

  if (err && !client) return <Err text={err} />
  if (!client || !s) return <Loading rows={3} />

  return (
    <div className="space-y-5 animate-fadeIn">
      <div>
        <div className="flex items-center gap-1.5 text-xs text-white/50 mb-2">
          <Link to="/app" className="hover:text-white/80">
            Clients
          </Link>
          <Icon.ChevronRight size={12} />
          <span>{client.name}</span>
        </div>
        <ClientHeader client={client} setClient={setClient} manager={manager} onDeleted={() => navigate('/app')} />
      </div>

      {google && <GoogleMessage kind={google.kind} reason={google.reason} onClose={() => setGoogle(null)} />}

      <ConnectionCard projectId={id} s={s} manager={manager} reload={reload} />

      <div className="flex items-center gap-2">
        <span className="pill-accent !h-[18px] !px-1.5 !text-[10px]">Beta</span>
        <span className="text-xs text-white/55">Tested only against a stand-in for Google Ads; not yet run on a real Google Ads account.</span>
      </div>

      <div>
        <div className="flex gap-1 overflow-x-auto no-scrollbar border-b border-hairline" role="tablist">
          {VIEWS.map((v) => (
            <button key={v.id} role="tab" aria-selected={view === v.id} onClick={() => goTab(v.id)} className={`tab ${view === v.id ? 'tab-on' : ''}`}>
              {v.label}
            </button>
          ))}
        </div>
        <p className="text-sm text-white/70 mt-3 max-w-[72ch]">{current.blurb}</p>
      </div>

      <AdsPilot projectId={id} view={view} s={s} setS={setS} goTab={goTab} />
    </div>
  )
}

function GoogleMessage({ kind, reason, onClose }: { kind: string; reason: string; onClose: () => void }) {
  const cls = kind === 'connected' ? 'text-success border-success/30' : kind === 'warning' ? 'text-warning border-warning/30' : 'text-danger border-danger/30'
  const text =
    kind === 'connected'
      ? 'Google Ads connected. Choose the account below if it is not chosen yet.'
      : kind === 'warning'
        ? `Google Ads connected, with a warning: ${reason}`
        : `Google sign-in did not finish: ${reason || 'no reason was given.'}`
  return (
    <div role="status" className={`glass p-3 text-sm flex items-start justify-between gap-3 ${cls}`}>
      <span>{text}</span>
      <button className="btn-ghost h-7 w-7 p-0 shrink-0" aria-label="Dismiss" onClick={onClose}>
        <Icon.X size={13} />
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ name, rename, remove */

function ClientHeader({ client, setClient, manager, onDeleted }: { client: Client; setClient: (c: Client) => void; manager: boolean; onDeleted: () => void }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(client.name)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const save = async () => {
    setBusy(true)
    setErr('')
    try {
      const r = await api.renameClient(client.id, name.trim())
      setClient(r.project)
      setEditing(false)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    setErr('')
    try {
      await api.deleteClient(client.id)
      onDeleted()
    } catch (e: any) {
      setErr(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      {editing ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <input className="input h-10 w-auto min-w-[260px] text-lg font-semibold" aria-label="Client name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="btn-primary" disabled={busy || !name.trim() || name.trim() === client.name}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="btn-ghost" onClick={() => (setEditing(false), setName(client.name), setErr(''))}>
            Cancel
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">{client.name}</h1>
          <button className="btn-ghost h-8 px-2.5 text-xs" onClick={() => setEditing(true)}>
            Rename
          </button>
          {manager && (
            <button className="btn-ghost h-8 px-2.5 text-xs hover:text-danger" onClick={() => setConfirmDelete(true)}>
              <Icon.Trash size={13} /> Remove client
            </button>
          )}
        </div>
      )}
      {confirmDelete && (
        <div className="glass p-4 border-danger/30 text-sm space-y-2">
          <p>
            Remove <b>{client.name}</b> from AdsPilot? Its sync history, suggestions and change journal go with it. Nothing in Google Ads is touched.
          </p>
          <div className="flex gap-2">
            <button className="btn-danger" disabled={busy} onClick={() => void remove()}>
              {busy ? 'Removing…' : 'Remove client'}
            </button>
            <button className="btn-ghost" disabled={busy} onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {err && <p className="text-xs text-danger">{err}</p>}
    </div>
  )
}

/* ------------------------------------------------------------------ the Google Ads connection */

function ConnectionCard({ projectId, s, manager, reload }: { projectId: string; s: AdsState; manager: boolean; reload: () => Promise<void> }) {
  const c = s.connection
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [pick, setPick] = useState(c?.account || '')
  const [confirmOff, setConfirmOff] = useState(false)

  useEffect(() => setPick(c?.account || ''), [c?.account])

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    setErr('')
    setNote('')
    try {
      await fn()
    } catch (e: any) {
      setErr(e.message)
      // A failed re-read stores its reason on the connection; read it back so the card says why.
      reload().catch(() => {})
    } finally {
      setBusy('')
    }
  }

  const connect = () =>
    run('connect', async () => {
      const r = await api.googleConnect(projectId)
      window.location.href = r.url
    })

  const choose = () =>
    run('choose', async () => {
      await api.googleAccount(projectId, pick)
      await reload()
      setNote(
        c?.writesAllowed
          ? 'Account chosen. Changes are switched OFF again for it until an owner or admin allows them on the Changes tab.'
          : 'Account chosen. AdsPilot reads it on the next sync; changes stay off until an owner or admin allows them on the Changes tab.',
      )
    })

  const reread = () =>
    run('reread', async () => {
      await api.googleAccounts(projectId)
      await reload()
      setNote('Account list read again from Google Ads.')
    })

  const disconnect = () =>
    run('disconnect', async () => {
      await api.googleDisconnect(projectId)
      setConfirmOff(false)
      await reload()
      setNote('Google Ads disconnected. Nothing in the account was changed.')
    })

  const accounts = c?.accounts || []
  const broken = accounts.filter((a) => a.error)
  const chosenChanged = !!pick && pick !== c?.account

  return (
    <section className="panel" id="google-connection">
      <div className="panel-head">
        <h3 className="panel-title">
          Google Ads connection
          {c ? <span className="pill-good">Connected</span> : <span className="pill-muted">Not connected</span>}
          {c?.account && (c.writesAllowed ? <span className="pill-watch">Changes allowed</span> : <span className="pill-muted">Read-only</span>)}
        </h3>
        {!c ? (
          <button className="btn-primary h-8 px-3 text-xs" disabled={!!busy} onClick={() => void connect()}>
            <Icon.Plug size={13} /> {busy === 'connect' ? 'Opening Google…' : 'Connect Google Ads'}
          </button>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary h-8 px-3 text-xs" disabled={!!busy} onClick={() => void connect()} title="Sign in with a different Google account; changes switch off again">
              Sign in again
            </button>
            {manager && (
              <button className="btn-ghost h-8 px-3 text-xs hover:text-danger" disabled={!!busy} onClick={() => setConfirmOff(true)}>
                Disconnect
              </button>
            )}
          </div>
        )}
      </div>
      <div className="panel-body text-sm space-y-3">
        {!c ? (
          <p className="text-white/70 leading-relaxed">
            Sign in with a Google account that can open this client’s Google Ads account. Google’s permission for Ads always includes changes; AdsPilot stays
            read-only until an owner or admin allows changes on the Changes tab.
          </p>
        ) : (
          <>
            <p className="text-white/75">Signed in as {c.email || 'an unknown Google account'}.</p>
            {!s.setup.developerToken && (
              <p className="text-xs text-warning">
                Google Ads is not switched on for this install yet: the platform administrator adds the developer token under{' '}
                <Link to="/app/admin" className="underline">
                  Admin
                </Link>
                , then press Re-read accounts.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="gads-account" className="text-xs text-white/70">
                Account
              </label>
              <select id="gads-account" className="input h-9 text-xs w-auto min-w-[260px]" value={pick} onChange={(e) => setPick(e.target.value)} disabled={accounts.length === 0 || !!busy}>
                <option value="">{accounts.length ? 'Choose the Google Ads account…' : 'No accounts to choose from'}</option>
                {accounts.map((a) => (
                  <option key={a.property} value={a.property} disabled={!!a.error}>
                    {a.name || a.property}
                    {a.currency ? ` · ${a.currency}` : ''}
                    {a.manager ? ' · manager' : ''}
                    {a.error ? ' · cannot be read' : ''}
                  </option>
                ))}
              </select>
              <button className="btn-primary h-9 px-3 text-xs" disabled={!chosenChanged || !!busy} title={!chosenChanged ? 'Choose a different account first.' : undefined} onClick={() => void choose()}>
                {busy === 'choose' ? 'Saving…' : 'Use this account'}
              </button>
              <button className="btn-secondary h-9 px-3 text-xs" disabled={!!busy} onClick={() => void reread()}>
                <Icon.Refresh size={13} /> {busy === 'reread' ? 'Reading…' : 'Re-read accounts'}
              </button>
            </div>
            {c.listError && <p className="text-xs text-danger">{c.listError}</p>}
            {!c.listError && accounts.length === 0 && <p className="text-xs text-white/60">That Google account cannot open any Google Ads account. Sign in again with the account that has access.</p>}
            {broken.length > 0 && (
              <ul className="text-xs text-white/60 space-y-0.5">
                {broken.map((a) => (
                  <li key={a.property}>
                    <span className="text-white/80">{a.name || a.property}</span>: <span className="text-danger">{a.error}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-white/55">Choosing a different account switches changes off again: a permission given for one account does not follow the client to another.</p>
          </>
        )}
        {confirmOff && (
          <div className="rounded-lg border border-danger/30 p-3 text-sm space-y-2">
            <p>Disconnect Google Ads from this client? AdsPilot stops reading the account. Nothing in Google Ads is changed.</p>
            <div className="flex gap-2">
              <button className="btn-danger h-8 px-3 text-xs" disabled={!!busy} onClick={() => void disconnect()}>
                {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
              </button>
              <button className="btn-ghost h-8 px-3 text-xs" disabled={!!busy} onClick={() => setConfirmOff(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        <Err text={err} />
        {note && <p className="text-xs text-success">{note}</p>}
      </div>
    </section>
  )
}
