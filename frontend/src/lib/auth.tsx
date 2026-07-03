import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api, tokenStore } from './api'
import type { Token, User } from './types'

type AuthContextValue = {
  user: User | null
  isLoading: boolean
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, displayName: string, password: string) => Promise<User>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [token, setToken] = useState<string | null>(() => tokenStore.get())

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => api<User>('/auth/me'),
    enabled: token !== null,
    staleTime: 5 * 60_000,
  })

  // If /me returns 401, the token is stale — drop it.
  useEffect(() => {
    if (meQuery.error instanceof ApiError && meQuery.error.status === 401) {
      tokenStore.clear()
      setToken(null)
      qc.removeQueries({ queryKey: ['me'] })
    }
  }, [meQuery.error, qc])

  const login = async (email: string, password: string) => {
    const t = await api<Token>('/auth/login', {
      method: 'POST',
      body: { email, password },
    })
    tokenStore.set(t.access_token)
    setToken(t.access_token)
    await qc.invalidateQueries({ queryKey: ['me'] })
  }

  const register = async (email: string, displayName: string, password: string) => {
    const newUser = await api<User>('/auth/register', {
      method: 'POST',
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
    login,
    register,
    logout,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
