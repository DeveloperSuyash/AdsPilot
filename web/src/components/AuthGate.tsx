// The door. Nobody signed in → sign in or create an account. Nothing below renders until /api/auth says who this is.
//
// It never falls through to the app when /auth fails: that would render the whole UI to whoever asked. It retries a few times for the
// still-starting case, then says plainly that the server cannot be reached.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Icon } from './Icons'
import { api } from '../lib/api'
import { SessionProvider } from '../lib/session'
import { CostProvider } from '../lib/cost'
import type { AuthStatus } from '../lib/types'

type Phase = 'loading' | 'locked' | 'open' | 'unreachable'

export function AuthGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [auth, setAuth] = useState<AuthStatus | null>(null)
  const [mode, setMode] = useState<'signin' | 'create'>('signin')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [workspace, setWorkspace] = useState('')
  const [password, setPassword] = useState('')
  const [setupKey, setSetupKey] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const check = async (attempt = 0) => {
    try {
      const s = await api.authStatus()
      setAuth(s)
      // With no accounts there is nothing to sign in to, so the door opens straight onto creating the first one.
      if (!s.accounts) setMode('create')
      setPhase(s.authed ? 'open' : 'locked')
    } catch {
      if (attempt < 3) {
        setTimeout(() => void check(attempt + 1), 700 * (attempt + 1))
        return
      }
      setPhase('unreachable')
    }
  }

  useEffect(() => {
    void check()
    const onUnauth = () => void check()
    window.addEventListener('ap-unauth', onUnauth)
    return () => window.removeEventListener('ap-unauth', onUnauth)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const first = !!auth && !auth.accounts
  const creating = mode === 'create'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      if (creating) {
        await api.register({ email, password, name, workspace: workspace.trim() || undefined, ...(first && auth?.setupKeyRequired ? { setupKey } : {}) })
      } else {
        await api.login(email, password)
      }
      setPassword('')
      await check()
    } catch (e: any) {
      setErr(e.message || "That didn't work")
    } finally {
      setBusy(false)
    }
  }

  if (phase === 'loading') return <div className="min-h-screen grid place-items-center text-white/70 text-sm">Loading…</div>

  if (phase === 'unreachable') {
    return (
      <Shell>
        <div className="glass p-6 w-full max-w-sm text-center">
          <p className="text-sm text-white/95">Can't reach the AdsPilot server.</p>
          <p className="text-xs text-white/70 mt-2">It may still be starting. Nothing is unlocked until it answers.</p>
          <button
            onClick={() => {
              setPhase('loading')
              void check()
            }}
            className="btn-secondary h-9 px-3 text-xs mt-4"
          >
            Try again
          </button>
        </div>
      </Shell>
    )
  }

  if (phase === 'open' && auth) {
    return (
      <SessionProvider value={auth}>
        <CostProvider value={auth.platformAdmin}>{children}</CostProvider>
      </SessionProvider>
    )
  }

  const signupOpen = !!auth?.signupOpen
  return (
    <Shell>
      <div className="w-full max-w-4xl grid md:grid-cols-2 gap-8 items-center animate-fadeIn">
        <div>
          <Brand />
          {first ? (
            <>
              <h1 className="text-3xl font-semibold tracking-tight mt-6">Set up this AdsPilot</h1>
              <p className="text-sm text-white/70 mt-3 leading-relaxed">
                The first account creates the workspace and runs the install: it adds the Google sign-in and the Google Ads developer token under Admin.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-3xl md:text-4xl font-semibold tracking-tight mt-6">Google Ads for agencies</h1>
              <p className="text-sm text-white/75 mt-4 leading-relaxed">
                AdsPilot reads each client's Google Ads account, finds the money spent with nothing to show for it, and suggests changes you approve one
                at a time. It only reads until an owner or admin allows changes, and every change it makes can be undone.
              </p>
            </>
          )}
        </div>

        <form onSubmit={submit} className="glass p-6 w-full max-w-sm md:justify-self-end">
          {!first && (
            <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-white/5 mb-5 text-xs">
              <button type="button" onClick={() => (setMode('signin'), setErr(''))} className={`h-8 rounded-md ${!creating ? 'bg-accent text-[#fff]' : 'text-white/70'}`}>
                Sign in
              </button>
              <button type="button" onClick={() => (setMode('create'), setErr(''))} className={`h-8 rounded-md ${creating ? 'bg-accent text-[#fff]' : 'text-white/70'}`}>
                Create account
              </button>
            </div>
          )}
          {first && <h2 className="text-lg font-semibold mb-4">Create the first account</h2>}

          {creating && !signupOpen ? (
            <p className="text-sm text-white/75 leading-relaxed">Sign-up is closed — ask your workspace owner to add you.</p>
          ) : (
            <>
              <div className="space-y-3">
                {creating && (
                  <>
                    <input className="input" placeholder="Your name" aria-label="Your name" value={name} onChange={(e) => setName(e.target.value)} required />
                    <input className="input" placeholder="Agency name (optional)" aria-label="Agency name" value={workspace} onChange={(e) => setWorkspace(e.target.value)} />
                  </>
                )}
                <input className="input" type="email" autoComplete="username" placeholder="Email" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                <input
                  className="input"
                  type="password"
                  autoComplete={creating ? 'new-password' : 'current-password'}
                  placeholder={creating ? 'Password — at least 10 characters' : 'Password'}
                  aria-label="Password"
                  minLength={creating ? 10 : undefined}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                {creating && first && auth?.setupKeyRequired && (
                  <div>
                    <input className="input font-mono" placeholder="Setup key" aria-label="Setup key" autoComplete="off" value={setupKey} onChange={(e) => setSetupKey(e.target.value)} required />
                    <p className="text-[11px] text-white/55 mt-1.5 leading-relaxed">Set on the server as AP_SETUP_KEY — proves you are the person who deployed this install.</p>
                  </div>
                )}
              </div>
              {err && <div className="mt-3 text-xs text-danger">{err}</div>}
              <button type="submit" disabled={busy} className="btn-primary w-full mt-5">
                {busy ? 'Working…' : creating ? 'Create account' : 'Sign in'}
              </button>
            </>
          )}
          {!creating && !signupOpen && <p className="text-[11px] text-white/60 mt-4 text-center">No account? Ask the owner of your workspace to add you.</p>}
        </form>
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="min-h-screen grid place-items-center p-6">{children}</div>
}

export function Brand({ center }: { center?: boolean }) {
  return (
    <div className={`flex items-center gap-2.5 ${center ? 'justify-center' : ''}`}>
      <div className="h-8 w-8 rounded-lg bg-accent flex items-center justify-center shadow-glow">
        <Icon.Bolt size={16} className="text-[#fff]" />
      </div>
      <div className="text-left">
        <div className="text-sm font-semibold tracking-tight leading-none">AdsPilot</div>
        <div className="text-[10px] text-white/60 mt-1">Google Ads for agencies — a PilotWorks4u product</div>
      </div>
    </div>
  )
}
