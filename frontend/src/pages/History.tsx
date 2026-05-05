import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import type { SessionSummary } from '@/lib/types'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  })
}

export function HistoryPage() {
  const sessionsQuery = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api<SessionSummary[]>('/sessions'),
  })

  const sessions = sessionsQuery.data ?? []

  return (
    <div className="max-w-5xl mx-auto px-6 lg:px-10 py-12 lg:py-16">
      <div className="flex items-end justify-between border-b border-rule pb-6">
        <div>
          <p className="mono-meta">The Archive</p>
          <h1 className="display-serif text-5xl lg:text-6xl leading-[1.02] mt-3">
            Past sessions, <span className="italic text-accent">filed</span>.
          </h1>
        </div>
        <Link to="/" className="no-underline hidden sm:block">
          <Button size="md">
            New session
            <ArrowRight size={14} strokeWidth={1.75} />
          </Button>
        </Link>
      </div>

      {sessionsQuery.isLoading && (
        <p className="mono-meta py-16">Loading archive…</p>
      )}

      {!sessionsQuery.isLoading && sessions.length === 0 && (
        <div className="py-24 text-center">
          <p className="mono-meta">Nothing on file</p>
          <p className="display-serif text-2xl mt-3 text-ink-soft italic">
            Begin your first session.
          </p>
          <div className="mt-6 inline-block">
            <Link to="/" className="no-underline">
              <Button size="md">
                Begin
                <ArrowRight size={14} strokeWidth={1.75} />
              </Button>
            </Link>
          </div>
        </div>
      )}

      {sessions.length > 0 && (
        <ul className="divide-y divide-rule mt-2">
          {sessions.map((s) => (
            <li key={s.id}>
              <Link
                to={`/sessions/${s.id}`}
                className="grid grid-cols-12 gap-4 py-6 no-underline group items-baseline hover:bg-paper-2/40 px-2 -mx-2 transition-colors"
              >
                <span className="col-span-2 sm:col-span-1 font-mono text-[0.7rem] tracking-[0.14em] text-ink-mute">
                  #{String(s.id).padStart(3, '0')}
                </span>
                <span className="col-span-7 sm:col-span-8 display-serif text-lg leading-snug text-ink line-clamp-2 group-hover:text-accent">
                  {s.job_posting}
                </span>
                <span className="col-span-3 sm:col-span-2 mono-meta text-right">
                  {formatDate(s.created_at)}
                </span>
                <span className="col-span-12 sm:col-span-1 mono-meta text-right">
                  {s.status === 'completed' ? 'Filed' : 'Open'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
