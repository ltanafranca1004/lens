import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '@/lib/auth'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  const loc = useLocation()

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-6 lg:px-10 py-24">
        <p className="mono-meta">Loading…</p>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  }

  return <>{children}</>
}
