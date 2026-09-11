import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'

type Mode = 'login' | 'register'

export function LoginPage() {
  const { login, register, isAuthenticated } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const from = (loc.state as { from?: string } | null)?.from ?? '/'

  useEffect(() => {
    if (isAuthenticated) nav(from, { replace: true })
  }, [isAuthenticated, nav, from])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === 'login') {
        await login(email, password)
      } else {
        await register(email, displayName, password)
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const isLogin = mode === 'login'

  return (
    <div className="min-h-full grid lg:grid-cols-2 bg-page">
      {/* Editorial left column */}
      <aside className="hidden lg:flex border-r border-line p-14 flex-col justify-between bg-paper">
        <Link to="/" className="font-serif text-[2rem] leading-none text-ink no-underline">
          Lens
        </Link>
        <div className="max-w-xl">
          <p className="font-serif text-[2.4rem] leading-[1.12] text-ink">
            A quiet place to rehearse the questions you&rsquo;re afraid of.
          </p>
          <p className="mt-6 text-[15.5px] leading-[1.62] text-ink-soft max-w-prose [text-wrap:pretty]">
            Paste a real job posting. Receive technical questions written for the role. Answer at
            your own pace. Read the reasoning behind every score.
          </p>
        </div>
        <ul className="meta space-y-2">
          <li>Tailored to the posting</li>
          <li>One question at a time</li>
          <li>Every score points at a phrase</li>
        </ul>
      </aside>

      {/* Form column */}
      <section className="p-8 lg:p-14 flex items-center bg-paper lg:bg-page">
        <form onSubmit={onSubmit} className="w-full max-w-md mx-auto">
          <p className="meta">{isLogin ? 'Sign in' : 'Create account'}</p>
          <h1 className="font-serif font-normal text-[2.4rem] mt-2 mb-9 leading-[1.08]">
            {isLogin ? 'Welcome back.' : 'Start practicing.'}
          </h1>

          <div className="space-y-7">
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            {!isLogin && (
              <Input
                label="Display name"
                type="text"
                autoComplete="name"
                required
                minLength={1}
                maxLength={80}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            )}

            <Input
              label="Password"
              type="password"
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              required
              minLength={isLogin ? 1 : 8}
              hint={!isLogin ? 'At least 8 characters.' : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <p className="mt-6 text-sm text-[oklch(0.5_0.14_25)]" role="alert">
              {error}
            </p>
          )}

          <div className="mt-9 flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => {
                setMode(isLogin ? 'register' : 'login')
                setError(null)
              }}
              className="meta hover:text-ink cursor-pointer"
            >
              {isLogin ? 'Need an account? Register' : 'Have an account? Sign in'}
            </button>
            <Button type="submit" loading={busy} size="lg">
              {isLogin ? 'Sign in' : 'Create'}
              <ArrowRight size={16} strokeWidth={1.75} />
            </Button>
          </div>
        </form>
      </section>
    </div>
  )
}
