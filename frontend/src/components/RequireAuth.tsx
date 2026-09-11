import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '@/lib/auth'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  const loc = useLocation()

  if (isLoading) {
    return (
      <div className="max-w-[1000px] mx-auto px-6 py-24">
        <p className="meta">Loading…</p>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  }

  return <>{children}</>
}
