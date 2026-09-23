import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { SESSION_EXPIRED_EVENT, api, tokenStore } from './api'
import type { Token, User } from './types'

type AuthContextValue = {
  user: User | null
  isLoading: boolean
  isAuthenticated: boolean
  sessionExpired: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, displayName: string, password: string) => Promise<User>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [token, setToken] = useState<string | null>(() => tokenStore.get())
  const [sessionExpired, setSessionExpired] = useState(false)

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => api<User>('/auth/me'),
    enabled: token !== null,
    staleTime: 5 * 60_000,
  })

  // Any 401 on an authenticated request means the token expired: api() has already cleared it, so
  // drop the user and their cached data. RequireAuth then sends them to /login.
  useEffect(() => {
    const onExpired = () => {
      setToken(null)
      setSessionExpired(true)
      qc.clear()
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  }, [qc])

  const login = async (email: string, password: string) => {
    const t = await api<Token>('/auth/login', {
      method: 'POST',
      unauthenticated: true,
      body: { email, password },
    })
    tokenStore.set(t.access_token)
    setToken(t.access_token)
    setSessionExpired(false)
    await qc.invalidateQueries({ queryKey: ['me'] })
  }

  const register = async (email: string, displayName: string, password: string) => {
    const newUser = await api<User>('/auth/register', {
      method: 'POST',
      unauthenticated: true,
      body: { email, display_name: displayName, password },
    })
    await login(email, password)
    return newUser
  }

  const logout = () => {
    tokenStore.clear()
    setToken(null)
    qc.clear()
  }

  const value: AuthContextValue = {
    user: meQuery.data ?? null,
    isLoading: token !== null && meQuery.isLoading,
    isAuthenticated: token !== null && meQuery.data !== undefined,
    sessionExpired,
    login,
    register,
    logout,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// A context provider and its hook are conventionally co-located; Fast Refresh's component-only rule
// does not apply to this shared hook.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
