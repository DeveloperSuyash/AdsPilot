// Every call to the AdsPilot server. In dev, Vite proxies /api → localhost:4020; in production the server serves this UI itself.
import type {
  ActivityItem,
  Action,
  AdsDraft,
  AdsJournalEntry,
  AdsMessage,
  AdsState,
  Alert,
  AuthStatus,
  Client,
  GadsAdmin,
  GoogleAdmin,
  Member,
} from './types'

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
    ...init,
  })
  // A 401 anywhere means the session is gone. Tell the shell once, so the whole app returns to the door instead of every screen
  // rendering its own error.
  if (res.status === 401) window.dispatchEvent(new CustomEvent('ap-unauth'))
  let body: any = null
  try {
    body = await res.json()
  } catch {
    /* empty body */
  }
  // The server's error text is written for people, so it is shown as it comes.
  if (!res.ok || body?.ok === false) throw new Error(body?.error || `Request failed (${res.status})`)
  return body as T
}

const post = <T>(path: string, body?: unknown) => call<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

export const api = {
  /* ---- auth and workspace ---- */
  authStatus: () => call<AuthStatus>('/auth'),
  register: (body: { email: string; password: string; name: string; workspace?: string; setupKey?: string }) => post<{ user: unknown }>('/register', body),
  login: (email: string, password: string) => post<{ user: unknown }>('/login', { email, password }),
  logout: () => post('/logout'),
  members: () => call<{ members: Member[]; role: string }>('/members'),
  addMember: (body: { email: string; password: string; name: string; role: 'admin' | 'member' }) => post<{ members: Member[] }>('/members', body),
  removeMember: (uid: string) => post<{ members: Member[] }>(`/members/${encodeURIComponent(uid)}/remove`),
  setAlertEmails: (emails: string) => post<{ emails: string[] }>('/alert-emails', { emails }),

  /* ---- clients (projects in the API) ---- */
  clients: () => call<{ projects: Client[]; emailOn: boolean; alertEmails: string[] }>('/projects'),
  addClient: (name: string) => post<{ project: Client }>('/projects', { name }),
  renameClient: (id: string, name: string) => post<{ project: Client }>(`/projects/${id}/rename`, { name }),
  deleteClient: (id: string) => post(`/projects/${id}/delete`, { confirm: true }),
  googleConnect: (id: string) => call<{ url: string }>(`/projects/${id}/google/connect`),
  googleAccounts: (id: string) => post<{ project: Client }>(`/projects/${id}/google/accounts`),
  googleAccount: (id: string, property: string) => post<{ project: Client }>(`/projects/${id}/google/account`, { property }),
  googleDisconnect: (id: string) => post<{ project: Client }>(`/projects/${id}/google/disconnect`),

  /* ---- queue, alerts, activity ---- */
  actions: (project?: string) => call<{ actions: Action[] }>(`/actions${project ? `?project=${encodeURIComponent(project)}` : ''}`),
  setAction: (id: string, status: 'done' | 'dismissed' | 'open') => post<{ action: Action }>(`/actions/${encodeURIComponent(id)}`, { status }),
  alerts: () => call<{ alerts: Alert[]; emailOn: boolean; whyNoEmail: string }>('/alerts'),
  ackAlert: (id: string) => post<{ alert: Alert }>(`/alerts/${encodeURIComponent(id)}/ack`),
  activity: () => call<{ activity: ActivityItem[] }>('/activity'),

  /* ---- platform admin ---- */
  adminGoogle: () => call<GoogleAdmin>('/admin/google'),
  setAdminGoogle: (body: { clientId: string; clientSecret?: string }) => post<GoogleAdmin>('/admin/google', body),
  adminGads: () => call<GadsAdmin>('/admin/gads'),
  setAdminGads: (body: { developerToken?: string; version?: string }) => post<GadsAdmin>('/admin/gads', body),

  /* ---- the Ads screen (identical contract to SEOPilot's) ---- */
  adsState: (id: string) => call<AdsState>(`/projects/${id}/ads`),
  adsSync: (id: string) => post<AdsState>(`/projects/${id}/ads/sync`),
  adsSettings: (id: string, body: { maxDailyBudget?: number | null; businessFacts?: string; brandWords?: string }) => post<AdsState>(`/projects/${id}/ads/settings`, body),
  adsWrites: (id: string, allow: boolean) => post<AdsState>(`/projects/${id}/ads/writes`, allow ? { allow: true, confirm: true } : { allow: false }),
  adsApply: (id: string, pid: string, to?: number) =>
    post<{ entry: AdsJournalEntry; state: AdsState }>(`/projects/${id}/ads/proposals/${encodeURIComponent(pid)}/apply`, to === undefined ? { confirm: true } : { confirm: true, to }),
  adsDismiss: (id: string, pid: string) => post<AdsState>(`/projects/${id}/ads/proposals/${encodeURIComponent(pid)}/dismiss`),
  adsUndo: (id: string, jid: string) => post<{ result: { verified: boolean; summary: string }; state: AdsState }>(`/projects/${id}/ads/journal/${encodeURIComponent(jid)}/undo`, { confirm: true }),
  adsCopy: (id: string, adGroupId: string) => post<{ draft: AdsDraft }>(`/projects/${id}/ads/copy`, { adGroupId }),
  adsCreateAd: (id: string, body: { adGroupId: string; headlines: string[]; descriptions: string[]; finalUrl: string; path1: string; path2: string }) =>
    post<{ entry: AdsJournalEntry; state: AdsState }>(`/projects/${id}/ads/copy/create`, { ...body, confirm: true }),
  adsAsk: (id: string, question: string) => post<{ answer: AdsMessage }>(`/projects/${id}/ads/ask`, { question }),
}
