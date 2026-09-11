import { Link, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '@/lib/auth'

function whenLabel() {
  const now = new Date()
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' })
  const hour = now.getHours()
  const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'
  return `${weekday} ${part}`
}

export function Layout() {
  const { user, logout } = useAuth()

  return (
    <div className="min-h-full flex flex-col">
      <header className="border-b border-line bg-page/60">
        <div className="max-w-[1000px] mx-auto px-6 sm:px-8 py-5 flex items-baseline justify-between gap-6">
          <Link to="/" className="font-serif text-[1.7rem] leading-none text-ink no-underline">
            Lens
          </Link>
          <nav className="flex items-baseline gap-5 sm:gap-6 meta">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `no-underline ${isActive ? 'text-ink' : 'hover:text-ink'}`
              }
            >
              New
            </NavLink>
            <NavLink
              to="/history"
              className={({ isActive }) =>
                `no-underline ${isActive ? 'text-ink' : 'hover:text-ink'}`
              }
            >
              Archive
            </NavLink>
            {user && (
              <span className="hidden sm:inline">
                {user.display_name} · {whenLabel()}
              </span>
            )}
            <button type="button" onClick={logout} className="cursor-pointer hover:text-ink">
              Sign out
            </button>
          </nav>
        </div>
      </header>

      <main className="flex-1 w-full">
        <div className="max-w-[1000px] mx-auto px-4 sm:px-6 py-6 sm:py-10">
          <div className="bg-paper border border-line rounded-sm px-6 sm:px-12 py-9 sm:py-12">
            <Outlet />
          </div>
        </div>
      </main>

      <footer className="border-t border-line">
        <div className="max-w-[1000px] mx-auto px-6 sm:px-8 py-5 meta flex justify-between">
          <span>Lens · interview practice</span>
          <span className="hidden sm:inline">Set in Newsreader &amp; Public Sans</span>
        </div>
      </footer>
    </div>
  )
}
