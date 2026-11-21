// Admin: the install-wide settings only the platform administrator can see. Everyone else gets "Not found." from the server, and
// the nav hides the link — a courtesy, not the lock.
import { useEffect, useState } from 'react'
import { Icon } from '../components/Icons'
import { Err, PageHead } from '../components/Bits'
import { api } from '../lib/api'
import { useSession } from '../lib/session'
import type { GadsAdmin, GoogleAdmin } from '../lib/types'

export function Admin() {
  const auth = useSession()
  const [google, setGoogle] = useState<GoogleAdmin | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!auth.platformAdmin) return
    api.adminGoogle().then(setGoogle).catch((e) => setErr(e.message))
  }, [auth.platformAdmin])

  if (!auth.platformAdmin) return <Err text="Not found." />

  return (
    <div className="space-y-5 animate-fadeIn max-w-3xl">
      <PageHead title="Admin" blurb="Install-wide settings: the Google sign-in every client uses, and the Google Ads developer token. One of each serves every workspace on this install." />
      <Err text={err} />
      <GoogleCard state={google} setState={setGoogle} />
      <GadsCard />
      <div className="glass p-5">
        <h2 className="text-sm font-semibold">AI daily limit</h2>
        <p className="text-xs text-white/70 mt-2 leading-relaxed">
          {google == null
            ? 'Reading…'
            : google.aiLimit
              ? `Each workspace may run ${google.aiLimit} AI requests (ad copy drafts and questions) in any 24 hours. The platform administrator is exempt.`
              : 'No daily limit is set: AI requests are not capped per workspace.'}{' '}
          It is set on the server (AP_AI_DAILY_LIMIT) and cannot be changed here.
        </p>
      </div>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState<'' | 'ok' | 'fail'>('')
  return (
    <button
      type="button"
      className="btn-secondary h-8 px-3 text-xs shrink-0"
      onClick={() =>
        navigator.clipboard
          .writeText(text)
          .then(() => setDone('ok'))
          .catch(() => setDone('fail'))
      }
    >
      {done === 'ok' ? (
        <>
          <Icon.Check size={12} /> Copied
        </>
      ) : done === 'fail' ? (
        'Select and copy it by hand'
      ) : (
        'Copy'
      )}
    </button>
  )
}

/** The Google OAuth client every client's Google sign-in goes through. The secret is never shown back; an empty box keeps it. */
function GoogleCard({ state, setState }: { state: GoogleAdmin | null; setState: (s: GoogleAdmin) => void }) {
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => setClientId(state?.clientId || ''), [state?.clientId])

  const changed = !!state && (clientId.trim() !== state.clientId || !!secret.trim())

  const save = async () => {
    setBusy(true)
    setErr('')
    setNote('')
    try {
      const r = await api.setAdminGoogle({ clientId: clientId.trim(), ...(secret.trim() ? { clientSecret: secret.trim() } : {}) })
      setState({ ...state, ...r })
      setSecret('')
      setNote('Saved. Clients can now connect Google Ads.')
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="glass p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold">Google sign-in (OAuth client)</h2>
        {!state ? null : state.clientId && state.hasSecret ? (
          <span className="pill pill-good">
            <Icon.Check size={12} /> Set{state.fromEnv ? ' (from the environment)' : ''}
          </span>
        ) : (
          <span className="pill pill-watch">Not set</span>
        )}
      </div>
      <p className="text-xs text-white/70 mt-2 leading-relaxed">
        A web-application OAuth client from Google Cloud, in a project with the Google Ads API enabled and the <span className="font-mono">adwords</span> scope on its
        consent screen. Every client signs in through it; there is no install-wide Google grant.
      </p>
      {state && (
        <div className="mt-4 space-y-1.5">
          <div className="text-xs text-white/70">Authorised redirect URI — register this exact URI in Google Cloud:</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 font-mono text-xs bg-white/[0.05] border border-hairline rounded-lg px-3 py-2 break-all">{state.redirectUri}</code>
            <CopyButton text={state.redirectUri} />
          </div>
        </div>
      )}
      {state && !state.fromEnv && (
        <div className="space-y-2 mt-4">
          <input className="input font-mono text-xs" aria-label="Google OAuth client ID" placeholder="Client ID (….apps.googleusercontent.com)" value={clientId} onChange={(e) => setClientId(e.target.value)} />
          <input
            className="input font-mono text-xs"
            type="password"
            autoComplete="off"
            aria-label="Google OAuth client secret"
            placeholder={state.hasSecret ? '•••••••••••• (paste a new secret to replace; leave empty to keep it)' : 'Client secret'}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
          <button onClick={() => void save()} disabled={busy || !changed} className="btn-secondary">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
      {state?.fromEnv && <p className="text-xs text-white/60 mt-3">Set by AP_GOOGLE_CLIENT_ID / AP_GOOGLE_CLIENT_SECRET on the server. Change it there.</p>}
      {note && <p className="text-xs text-success mt-3">{note}</p>}
      {err && <p className="text-xs text-danger mt-3">{err}</p>}
    </div>
  )
}

/**
 * The Google Ads developer token and API version, install-wide. AdsPilot reads nothing without the token. The token is never shown back,
 * so an empty box on Save keeps the one that is set (the server only replaces it when a new one is sent).
 */
function GadsCard() {
  const [state, setState] = useState<GadsAdmin | null>(null)
  const [token, setToken] = useState('')
  const [version, setVersion] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    api
      .adminGads()
      .then((r) => {
        setState(r)
        setVersion(r.version)
      })
      .catch((e) => setErr(e.message))
  }, [])

  const versionBad = version.trim() !== '' && !/^v\d{2,3}$/.test(version.trim())
  const changed = !!token.trim() || (state ? version.trim() !== state.version : false)

  const save = async () => {
    setBusy(true)
    setErr('')
    setNote('')
    try {
      const r = await api.setAdminGads({ ...(token.trim() ? { developerToken: token.trim() } : {}), version: version.trim() })
      setState(r)
      setVersion(r.version)
      setToken('')
      setNote('Saved. Clients can read their Google Ads accounts on the next sync.')
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="glass p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold">Google Ads</h2>
        {!state ? null : state.hasToken ? (
          <span className="pill pill-good">
            <Icon.Check size={12} /> Developer token set{state.fromEnv ? ' (from the environment)' : ''}
          </span>
        ) : (
          <span className="pill pill-watch">No developer token</span>
        )}
      </div>
      <p className="text-xs text-white/70 mt-2 leading-relaxed">
        The developer token comes from the Google Ads API Center of the platform’s manager account. A token at Test access only works with test accounts; real
        client accounts need Basic access or higher. One token serves every workspace on this install.
      </p>
      {state && !state.fromEnv && (
        <div className="space-y-2 mt-4">
          <input
            className="input font-mono text-xs"
            type="password"
            autoComplete="off"
            aria-label="Google Ads developer token"
            placeholder={state.hasToken ? '•••••••••••• (paste a new token to replace; leave empty to keep it)' : 'Developer token'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <div className="flex gap-2 items-center flex-wrap">
            <label htmlFor="gads-version" className="text-xs text-white/70">
              API version
            </label>
            <input id="gads-version" className="input h-9 w-28 font-mono text-xs" value={version} placeholder={state.defaultVersion} onChange={(e) => setVersion(e.target.value)} />
            <button onClick={() => void save()} disabled={busy || !changed || versionBad} className="btn-secondary">
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
          {versionBad && <p className="text-xs text-danger">The version looks like “v22”.</p>}
        </div>
      )}
      {state?.fromEnv && <p className="text-xs text-white/60 mt-3">Set by AP_GADS_DEVELOPER_TOKEN on the server (version {state.version}). Change it there.</p>}
      {note && <p className="text-xs text-success mt-3">{note}</p>}
      {err && <p className="text-xs text-danger mt-3">{err}</p>}
      <div className="mt-4 p-3 rounded-xl bg-white/[0.03] border border-hairline text-xs text-white/70 leading-relaxed">
        <span className="text-white/95 font-medium">The version</span> is the Google Ads API version AdsPilot calls (default {state?.defaultVersion || 'v22'}; empty uses the
        default). Google retires a version roughly a year after it is released, so check it against{' '}
        <a href="https://developers.google.com/google-ads/api/docs/sunset-dates" target="_blank" rel="noreferrer" className="text-accent hover:underline">
          Google’s sunset dates
        </a>{' '}
        when syncs start failing.
      </div>
    </div>
  )
}
