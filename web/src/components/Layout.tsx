// The frame: sidebar, top bar, and a bottom bar on a phone. SEOPilot's shape and theming, cut to what AdsPilot has.
import { useState, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { Icon } from './Icons'
import { api } from '../lib/api'
import { useSession } from '../lib/session'
import { getTheme, toggleTheme, type Theme } from '../lib/theme'

type NavItem = { to: string; label: string; icon: typeof Icon.Bolt; end?: boolean }

const NAV: NavItem[] = [
  { to: '/app', label: 'Clients', icon: Icon.Projects, end: true },
  { to: '/app/alerts', label: 'Alerts', icon: Icon.Bell },
  { to: '/app/queue', label: 'Work queue', icon: Icon.ListChecks },
  { to: '/app/team', label: 'Team', icon: Icon.People },
]
// Hidden for everybody else, but hiding it is a courtesy: /api/admin answers "Not found." to anyone who is not the platform admin.
const ADMIN: NavItem = { to: '/app/admin', label: 'Admin', icon: Icon.Shield }

export function Layout({ children }: { children: ReactNode }) {
  const auth = useSession()
  const [theme, setTheme] = useState<Theme>(getTheme())
  const items = auth.platformAdmin ? [...NAV, ADMIN] : NAV
  const who = auth.user ? `${auth.user.name || auth.user.email}${auth.user.name ? ` (${auth.user.email})` : ''}` : ''
  const initials = (auth.user?.name || auth.user?.email || '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')

  const signOut = async () => {
    try {
      await api.logout()
    } catch {
      /* the cookie is being dropped either way */
    }
    // A full reload: the door has to re-ask who we are, and every screen is holding data that is no longer ours to show.
    window.location.href = '/app'
  }

  return (
    <div className="h-screen flex overflow-hidden">
      <aside className="hidden lg:flex w-[232px] shrink-0 h-screen flex-col border-r border-hairline bg-base-elevated">
        <div className="flex items-center gap-2.5 px-[18px] h-[60px] border-b border-hairline">
          <div className="h-8 w-8 rounded-[9px] bg-accent flex items-center justify-center shadow-glow">
            <Icon.Bolt size={16} className="text-[#fff]" />
          </div>
          <div className="min-w-0">
            <div className="text-[14.5px] font-semibold tracking-tight leading-none">AdsPilot</div>
            <div className="text-[11px] text-white/50 mt-1 truncate">{auth.org?.name || 'PilotWorks4u'}</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-0.5">
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-item ${isActive ? 'nav-item-active' : ''}`}>
              <item.icon size={16} />
              <span className="flex-1 truncate">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="px-[18px] py-3 border-t border-hairline text-[11px] text-white/45 leading-relaxed">Google Ads for agencies — a PilotWorks4u product</div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <header className="sticky top-0 z-30 h-[60px] border-b border-hairline bg-base/80 backdrop-blur-xl flex items-center justify-between px-4 sm:px-6 safe-top">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="lg:hidden flex items-center gap-2 shrink-0">
              <div className="h-8 w-8 rounded-lg bg-accent flex items-center justify-center shadow-glow">
                <Icon.Bolt size={16} className="text-[#fff]" />
              </div>
              <span className="text-sm font-semibold tracking-tight">AdsPilot</span>
            </div>
            <span className="hidden sm:inline text-sm text-white/70 truncate">{auth.org?.name}</span>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <span className="pill-accent hidden sm:inline-flex" title="Free while it is tested">
              Beta
            </span>
            <button
              onClick={() => setTheme(toggleTheme())}
              className="btn-ghost h-10 w-10 p-0 rounded-xl"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <Icon.Sun size={18} /> : <Icon.Moon size={18} />}
            </button>
            {who && <span className="hidden md:inline text-xs text-white/65 max-w-[220px] truncate">{who}</span>}
            <span className="hidden sm:grid h-8 w-8 rounded-full bg-base-hover border border-white/[0.16] place-items-center text-xs font-semibold text-white/90" title={who} aria-hidden="true">
              {initials}
            </span>
            <button onClick={() => void signOut()} className="btn-ghost h-10 px-2.5 rounded-xl text-white/70 hover:text-danger" title={who ? `Sign out — ${who}` : 'Sign out'}>
              <Icon.Logout size={18} /> <span className="hidden sm:inline text-xs">Sign out</span>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto pb-20 lg:pb-0">
          <div className="w-full max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-6">{children}</div>
        </main>
      </div>

      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-hairline bg-base/90 backdrop-blur-xl safe-bottom">
        <div className="flex items-stretch h-16">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `flex flex-col items-center justify-center gap-1 flex-1 min-w-0 transition-colors ${isActive ? 'text-accent' : 'text-white/70'}`}
            >
              <item.icon size={20} />
              <span className="text-[10px] font-medium leading-none">{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
