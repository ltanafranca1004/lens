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
    <div className="min-h-full grid lg:grid-cols-12">
      {/* Editorial left column */}
      <aside className="hidden lg:flex lg:col-span-7 border-r border-rule p-14 flex-col justify-between">
        <div>
          <p className="mono-meta">Issue 01 — Inaugural</p>
          <Link
            to="/"
            className="display-serif text-[clamp(3rem,7vw,5rem)] leading-[0.95] text-ink no-underline mt-6 block"
            style={{ fontVariationSettings: '"opsz" 144' }}
          >
            Lens.
          </Link>
        </div>

        <div className="max-w-xl">
          <p className="display-serif text-3xl leading-tight text-ink-2">
            A quiet place to rehearse the questions you&rsquo;re afraid of.
          </p>
          <p className="mt-6 text-base leading-relaxed text-ink-soft max-w-prose">
            Paste a real job posting. Receive technical questions written for the role.
            Answer at your own pace. Read the feedback. Try again tomorrow.
          </p>
        </div>

        <ul className="mono-meta space-y-2">
          <li>01 — Tailored to the posting</li>
          <li>02 — One question at a time</li>
          <li>03 — Honest written feedback</li>
        </ul>
      </aside>

      {/* Form column */}
      <section className="lg:col-span-5 p-8 lg:p-14 flex items-center">
        <form onSubmit={onSubmit} className="w-full max-w-md mx-auto">
          <p className="mono-meta">{isLogin ? 'Sign in' : 'Create account'}</p>
          <h1 className="display-serif text-4xl mt-3 mb-10 leading-[1.05]">
            {isLogin ? 'Welcome back.' : 'Begin a new field journal.'}
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
            <p className="mt-6 text-sm text-danger" role="alert">
              {error}
            </p>
          )}

          <div className="mt-10 flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => {
                setMode(isLogin ? 'register' : 'login')
                setError(null)
              }}
              className="mono-meta hover:text-ink cursor-pointer"
            >
              {isLogin ? 'Need an account? Register' : 'Have an account? Sign in'}
            </button>
            <Button type="submit" loading={busy} size="lg" variant="primary">
              {isLogin ? 'Sign in' : 'Create'}
              <ArrowRight size={16} strokeWidth={1.75} />
            </Button>
          </div>
        </form>
      </section>
    </div>
  )
}
