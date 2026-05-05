import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/Button'

function MastheadDate() {
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  return <span>{today}</span>
}

export function Layout() {
  const { user, logout } = useAuth()
  const loc = useLocation()
  const issueNumber = String(user?.id ?? 0).padStart(3, '0')

  return (
    <div className="min-h-full flex flex-col">
      <header className="border-b border-rule">
        <div className="max-w-6xl mx-auto px-6 lg:px-10 pt-6 pb-4">
          <div className="flex items-baseline justify-between mono-meta">
            <span>Vol. I — Iss. {issueNumber}</span>
            <MastheadDate />
          </div>
          <div className="flex items-end justify-between mt-3 gap-6">
            <Link
              to="/"
              className="display-serif text-[clamp(2.4rem,6vw,3.6rem)] leading-[0.95] text-ink no-underline"
              style={{ fontVariationSettings: '"opsz" 144, "SOFT" 0' }}
            >
              Lens
            </Link>
            <nav className="hidden sm:flex items-center gap-7 pb-2 mono-meta">
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  `no-underline ${isActive ? 'text-ink' : 'text-ink-mute hover:text-ink'}`
                }
              >
                New
              </NavLink>
              <NavLink
                to="/history"
                className={({ isActive }) =>
                  `no-underline ${isActive ? 'text-ink' : 'text-ink-mute hover:text-ink'}`
                }
              >
                Archive
              </NavLink>
              <span className="text-ink-mute">·</span>
              <span className="text-ink-mute">{user?.display_name}</span>
              <Button variant="ghost" size="sm" onClick={logout}>
                Sign out
              </Button>
            </nav>
          </div>
          <p className="mono-meta mt-3">
            A field journal for technical interviews — {loc.pathname === '/' ? 'No. 01' : 'continued'}
          </p>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-rule mt-16">
        <div className="max-w-6xl mx-auto px-6 lg:px-10 py-6 mono-meta flex justify-between">
          <span>Lens · Field Notes</span>
          <span>Set in Fraunces &amp; IBM Plex</span>
        </div>
      </footer>
    </div>
  )
}
