// Team: who is in this workspace, and where alerts are emailed. No email invites: the owner or an admin sets the first password and
// hands it over (there may be no mail set up, and an invite that silently never arrives is worse than none).
import { useEffect, useState, type FormEvent } from 'react'
import { Icon } from '../components/Icons'
import { Err, Loading, PageHead } from '../components/Bits'
import { Card, Note } from '../components/PanelParts'
import { api } from '../lib/api'
import { canManage, useSession } from '../lib/session'
import type { Member } from '../lib/types'

export function Team() {
  const auth = useSession()
  const manager = canManage(auth)
  const [members, setMembers] = useState<Member[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'member' as 'admin' | 'member' })
  const [addErr, setAddErr] = useState('')
  const [addNote, setAddNote] = useState('')
  const [removing, setRemoving] = useState<Member | null>(null)

  useEffect(() => {
    api
      .members()
      .then((r) => setMembers(r.members))
      .catch((e) => setErr(e.message))
  }, [])

  const add = async (e: FormEvent) => {
    e.preventDefault()
    setBusy('add')
    setAddErr('')
    setAddNote('')
    try {
      const r = await api.addMember(form)
      setMembers(r.members)
      setAddNote(`${form.email} can now sign in with the password you set. Hand it over yourself: AdsPilot sends no invite email.`)
      setForm({ email: '', name: '', password: '', role: 'member' })
    } catch (e: any) {
      setAddErr(e.message)
    } finally {
      setBusy('')
    }
  }

  const remove = async (m: Member) => {
    setBusy(m.id)
    setErr('')
    try {
      const r = await api.removeMember(m.id)
      setMembers(r.members)
      setRemoving(null)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="space-y-5 animate-fadeIn">
      <PageHead title="Team" blurb={`The people in ${auth.org?.name || 'this workspace'}. An owner or admin can add and remove people, set where alerts go, and allow changes on an account.`} />
      <Err text={err} />
      <Card title="Members" flush>
        {!members ? (
          <div className="p-[18px]">{!err && <Loading rows={1} />}</div>
        ) : (
          members.map((m) => (
            <div key={m.id} className="prow items-center">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-white/95 truncate">
                  {m.name || m.email} {m.id === auth.user?.id && <span className="text-white/45 text-xs font-normal">(you)</span>}
                </div>
                <div className="text-xs text-white/55 truncate">{m.email}</div>
              </div>
              <span className={m.role === 'owner' ? 'pill-accent' : m.role === 'admin' ? 'pill-watch' : 'pill-muted'}>{m.role}</span>
              {manager && m.role !== 'owner' && m.id !== auth.user?.id && (
                <button className="btn-ghost h-8 px-2.5 text-xs hover:text-danger" disabled={!!busy} onClick={() => setRemoving(m)}>
                  Remove
                </button>
              )}
            </div>
          ))
        )}
        {removing && (
          <div className="p-4 border-t border-hairline text-sm space-y-2">
            <p>
              Remove <b>{removing.name || removing.email}</b> from this workspace? They are signed out of it at once.
            </p>
            <div className="flex gap-2">
              <button className="btn-danger h-8 px-3 text-xs" disabled={!!busy} onClick={() => void remove(removing)}>
                {busy === removing.id ? 'Removing…' : 'Remove'}
              </button>
              <button className="btn-ghost h-8 px-3 text-xs" disabled={!!busy} onClick={() => setRemoving(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </Card>

      {manager ? (
        <Card title="Add a person">
          <form onSubmit={add} className="grid sm:grid-cols-2 gap-3 text-sm">
            <input className="input" type="email" placeholder="Email" aria-label="Email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <input className="input" placeholder="Name" aria-label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder="Initial password — at least 10 characters"
              aria-label="Initial password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <select className="input" aria-label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'admin' | 'member' })}>
              <option value="member">Member — works on clients, approves allowed changes</option>
              <option value="admin">Admin — also manages people, alerts and allowing changes</option>
            </select>
            <div className="sm:col-span-2 flex items-center gap-2 flex-wrap">
              <button type="submit" className="btn-primary" disabled={busy === 'add' || !form.email.trim()}>
                <Icon.Plus size={14} /> {busy === 'add' ? 'Adding…' : 'Add person'}
              </button>
              {addErr && <span className="text-xs text-danger">{addErr}</span>}
              {addNote && <span className="text-xs text-success">{addNote}</span>}
            </div>
          </form>
          <Note>Someone who already has an AdsPilot account is added with their existing password; the one typed here is only used for a new account.</Note>
        </Card>
      ) : (
        <p className="text-xs text-white/55">Only the workspace owner or an admin can add or remove people.</p>
      )}

      <AlertEmails manager={manager} />
    </div>
  )
}

function AlertEmails({ manager }: { manager: boolean }) {
  const [saved, setSaved] = useState<string[] | null>(null)
  const [emailOn, setEmailOn] = useState(true)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    api
      .clients()
      .then((r) => {
        setSaved(r.alertEmails)
        setText(r.alertEmails.join(', '))
        setEmailOn(r.emailOn)
      })
      .catch((e) => setErr(e.message))
  }, [])

  const save = async () => {
    setBusy(true)
    setErr('')
    setNote('')
    try {
      const r = await api.setAlertEmails(text)
      setSaved(r.emails)
      setText(r.emails.join(', '))
      setNote(r.emails.length ? `Saved: ${r.emails.length} address${r.emails.length === 1 ? '' : 'es'}.` : 'Saved: no addresses, so alerts are shown in AdsPilot only.')
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Where alerts are emailed">
      {!saved ? (
        err ? <Err text={err} /> : <Loading rows={1} />
      ) : (
        <div className="space-y-2 text-sm">
          {!emailOn && <p className="text-xs text-warning">Email is not set up on this install, so nothing is sent to these addresses yet. Alerts are listed on the Alerts screen.</p>}
          {manager ? (
            <>
              <textarea className="input h-20 py-2" aria-label="Alert email addresses" placeholder="you@agency.com, team@agency.com" value={text} onChange={(e) => setText(e.target.value)} />
              <div className="flex items-center gap-2 flex-wrap">
                <button className="btn-secondary" disabled={busy || text === saved.join(', ')} onClick={() => void save()}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
                {err && <span className="text-xs text-danger">{err}</span>}
                {note && <span className="text-xs text-success">{note}</span>}
              </div>
            </>
          ) : (
            <p className="text-white/75">{saved.length ? saved.join(', ') : 'No addresses set.'}</p>
          )}
          <Note>Addresses belong to the workspace, never to a client: an alert is the agency's to read first. Anything that is not a valid address is dropped on save.</Note>
        </div>
      )}
    </Card>
  )
}
