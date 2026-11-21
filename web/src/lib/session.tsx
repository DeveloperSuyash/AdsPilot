// Who is signed in, for every screen below the door. Read once by AuthGate and handed down, so the nav, the cost hints and the
// owner/admin-only controls all agree with the same /api/auth answer.
import { createContext, useContext } from 'react'
import type { AuthStatus } from './types'

const Ctx = createContext<AuthStatus | null>(null)
export const SessionProvider = Ctx.Provider
export function useSession(): AuthStatus {
  const s = useContext(Ctx)
  if (!s) throw new Error('useSession outside the signed-in app')
  return s
}
/** Owner or admin: may add people, set alert emails, disconnect Google and allow changes. */
export const canManage = (s: AuthStatus) => s.org?.role === 'owner' || s.org?.role === 'admin'
