// The work queue: what the syncs found, per client. Dismissed stays dismissed; done reopens if the next sync still finds it.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icons'
import { Empty, Err, Loading, PageHead, PriorityPill } from '../components/Bits'
import { api } from '../lib/api'
import { timeAgo } from '../lib/format'
import { useClients } from '../lib/useClients'
import type { Action } from '../lib/types'

type Filter = 'open' | 'done' | 'dismissed'
const RANK = { high: 0, medium: 1, low: 2 } as const

export function Queue() {
  const [actions, setActions] = useState<Action[] | null>(null)
  const [err, setErr] = useState('')
  const [filter, setFilter] = useState<Filter>('open')
  const [busy, setBusy] = useState('')
  const { clients, nameOf } = useClients()

  useEffect(() => {
    api
      .actions()
      .then((r) => setActions(r.actions))
      .catch((e) => setErr(e.message))
  }, [])

  const set = async (id: string, status: Filter) => {
    setBusy(id)
    setErr('')
    try {
      const r = await api.setAction(id, status)
      setActions((xs) => (xs ? xs.map((a) => (a.id === id ? r.action : a)) : xs))
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy('')
    }
  }

  // "resolved" (the finding went away by itself) is shown with done: there is nothing left to do about it.
  const shown = (actions || []).filter((a) => (filter === 'done' ? a.status === 'done' || a.status === 'resolved' : a.status === filter))
  const groups = new Map<string, Action[]>()
  for (const a of shown) groups.set(a.project_id, [...(groups.get(a.project_id) || []), a])
  for (const list of groups.values()) list.sort((a, b) => RANK[a.priority] - RANK[b.priority])
  const order = [...groups.keys()].sort((a, b) => {
    const ia = clients.findIndex((c) => c.id === a)
    const ib = clients.findIndex((c) => c.id === b)
    return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib)
  })
  const count = (f: Filter) => (actions || []).filter((a) => (f === 'done' ? a.status === 'done' || a.status === 'resolved' : a.status === f)).length

  return (
    <div className="space-y-5 animate-fadeIn">
      <PageHead title="Work queue" blurb="What the syncs found in each client's account, most important first. Changes themselves are approved on the client's Changes tab." />
      <div className="seg" role="tablist" aria-label="Show">
        {(['open', 'done', 'dismissed'] as Filter[]).map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} className={`seg-btn ${filter === f ? 'seg-btn-on' : ''}`} onClick={() => setFilter(f)}>
            {f[0].toUpperCase() + f.slice(1)} <span className="tab-count ml-1">{count(f)}</span>
          </button>
        ))}
      </div>
      <Err text={err} />
      {!actions ? (
        !err && <Loading rows={2} />
      ) : shown.length === 0 ? (
        <Empty
          icon={Icon.ListChecks}
          title={filter === 'open' ? 'Nothing open' : `Nothing ${filter}`}
          body={filter === 'open' ? 'Every finding is handled, or no client has synced yet.' : 'Nothing here yet.'}
        />
      ) : (
        order.map((pid) => (
          <section key={pid} className="panel">
            <div className="panel-head">
              <h3 className="panel-title">{nameOf(pid)}</h3>
              <Link to={`/app/accounts/${pid}`} className="panel-link">
                Open client <Icon.ChevronRight size={12} />
              </Link>
            </div>
            {groups.get(pid)!.map((a) => (
              <div key={a.id} className="prow">
                <span className={`rail ${a.status === 'open' ? `rail-${a.priority}` : 'rail-done'}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <PriorityPill priority={a.priority} />
                    {a.status === 'resolved' && <span className="pill-muted">Gone from the latest sync</span>}
                    <span className="font-medium text-white/95">{a.title}</span>
                  </div>
                  {a.detail && <p className="text-[13px] text-white/70 mt-1 leading-relaxed">{a.detail}</p>}
                  <div className="text-xs text-white/45 mt-1">Updated {timeAgo(a.updated_at)}</div>
                </div>
                <div className="flex gap-1.5 self-start shrink-0">
                  {a.status === 'open' ? (
                    <>
                      <button className="btn-secondary h-8 px-3 text-xs" disabled={!!busy} onClick={() => void set(a.id, 'done')}>
                        <Icon.Check size={12} /> Done
                      </button>
                      <button className="btn-ghost h-8 px-3 text-xs" disabled={!!busy} onClick={() => void set(a.id, 'dismissed')}>
                        Dismiss
                      </button>
                    </>
                  ) : (
                    <button className="btn-ghost h-8 px-3 text-xs" disabled={!!busy} onClick={() => void set(a.id, 'open')}>
                      Reopen
                    </button>
                  )}
                </div>
              </div>
            ))}
          </section>
        ))
      )}
      <p className="text-[11.5px] text-white/50">A dismissed item stays dismissed. One marked done comes back if the next sync still finds it.</p>
    </div>
  )
}
