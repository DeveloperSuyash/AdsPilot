// The shapes the AdsPilot server sends. Kept in one file so a screen and the route it reads cannot quietly disagree.

export type Role = 'owner' | 'admin' | 'member'

export type AuthStatus = {
  accounts: boolean
  signupOpen: boolean
  setupKeyRequired: boolean
  authed: boolean
  user: { id: string; email: string; name: string } | null
  org: { id: string; name: string; role: Role } | null
  platformAdmin: boolean
}

/** A client: one Google Ads account. The API calls it a project. */
export type Client = {
  id: string
  name: string
  created_at: string
  connected: boolean
  account: string
  accountName: string
  writesAllowed: boolean
}

export type Member = { id: string; email: string; name: string; role: Role }

export type Action = {
  id: string
  project_id: string
  type: string
  title: string
  detail: string
  priority: 'high' | 'medium' | 'low'
  status: 'open' | 'done' | 'dismissed' | 'resolved'
  evidence: unknown
  updated_at: string
}

export type Alert = {
  id: string
  project_id: string
  type: string
  severity: 'critical' | 'serious'
  title: string
  detail: string
  status: 'open' | 'resolved'
  raised_at: string
  acknowledged_at: string | null
  notified_at: string | null
  occurrences: number
}

export type ActivityItem = { kind: string; title: string; detail: string; at: string }

export type GoogleAdmin = { clientId: string; hasSecret: boolean; fromEnv: boolean; redirectUri: string; aiLimit?: number }

/* ---- The Ads screen — server/routes/ads.js ---- */
export type AdsAccount = { property: string; name: string; currency?: string; manager?: boolean; error?: string }
export type AdsMetric = { key: string; label: string; value: number | null; previous: number | null; format: 'money' | 'number' | 'ratio' | 'percent'; betterWhen: 'lower' | 'higher' }
export type AdsCampaign = {
  id: string
  name: string
  status: string
  channel: string
  bidding: string
  budget: number | null
  budgetShared: boolean
  lostToBudget: number | null
  impressionShare: number | null
  cost: number
  clicks: number
  impressions: number
  conversions: number
  value: number
}
export type AdsSync = {
  at: string
  range: { current: { start: string; end: string }; previous: { start: string; end: string }; days: number }
  account: { id: string; name: string; currency: string; timeZone: string }
  metrics: AdsMetric[]
  capped: { searchTerms: boolean; keywords: boolean; ads: boolean; campaigns: boolean }
  campaigns: AdsCampaign[]
}
export type AdsFindings = {
  kpis: { cost: number; clicks: number; impressions: number; conversions: number; value: number; cpa: number | null; roas: number | null; ctr: number | null; cpc: number | null }
  currency: string
  tracking: null | { kind: 'stopped' | 'none'; cost: number; detail: string }
  wastedTerms: { term: string; campaignId: string; campaign: string; adGroup: string; cost: number; clicks: number; impressions: number; timesCpa: number }[]
  negativeWords: { word: string; terms: number; cost: number; clicks: number; campaignIds: string[] }[]
  budgetLimited: { campaignId: string; campaign: string; budget: number | null; shared: boolean; lostToBudget: number | null; cpa: number | null; conversions: number; cost: number }[]
  disapproved: { adId: string; campaign: string; adGroup: string; finalUrl: string }[]
  lowQuality: { resource: string; keyword: string; match: string; qualityScore: number; campaign: string; adGroup: string; adGroupId: string; cost: number; clicks: number; conversions: number }[]
  weakAds: { adId: string; campaign: string; adGroup: string; adGroupId: string; impressions: number; headlines: string[]; descriptions: string[]; finalUrl: string }[]
  landingPages: { url: string; cost: number; clicks: number; conversions: number; ads: number }[]
  notes: string[]
}
export type AdsProposal = {
  id: string
  kind: 'add_negative' | 'set_budget' | 'pause_keyword'
  status: 'open' | 'applied' | 'dismissed' | 'undone'
  reason: string
  campaignId?: string
  campaign?: string
  text?: string
  match?: string
  budgetResource?: string
  from?: number
  to?: number
  resource?: string
  keyword?: string
  adGroup?: string
  cost?: number
  journal_id?: string
}
export type AdsJournalEntry = {
  id: string
  proposal_id?: string
  kind: string
  summary: string
  applied_at: string
  applied_by: string
  verified: boolean
  undone_at?: string | null
  undone_by?: string
  undo_verified?: boolean
  before: unknown
  after: unknown
  target: unknown
}
export type AdsDraft = {
  headlines: string[]
  descriptions: string[]
  dropped: { kind: string; text: string; why: string }[]
  enough: boolean
  adGroupId: string
  adGroup: string
  campaign: string
  finalUrl: string
  at: string
}
export type AdsMessage = { role: 'user' | 'assistant'; content: string; unsupported?: string[]; sync_at?: string; at: string }
export type AdsState = {
  setup: { developerToken: boolean; connected: boolean; accountChosen: boolean; canAllowWrites: boolean }
  connection: null | { email: string; account: string; accountName: string; writesAllowed: boolean; writesAllowedBy: string; accounts: AdsAccount[]; listError: string }
  lastSync: null | { at: string; ok: boolean; error: string }
  sync: AdsSync | null
  findings: AdsFindings | null
  proposals: AdsProposal[]
  journal: AdsJournalEntry[]
  settings: { maxDailyBudget: number | null; businessFacts: string; brandWords: string }
  thread: AdsMessage[]
  drafts: Record<string, AdsDraft>
  limits: { budgetMaxStepPercent: number; rsa: { headline: number; description: number; path: number } }
  /** Always null in AdsPilot (SEOPilot links a site to DevPilot; there is no site here). */
  devpilot: null | { url: string; projectId: string; projectName: string }
}
export type GadsAdmin = { hasToken: boolean; fromEnv: boolean; version: string; defaultVersion: string }
