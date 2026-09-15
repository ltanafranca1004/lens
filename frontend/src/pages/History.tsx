import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { roleLabel } from '@/lib/rubric'
import type { SessionSummary } from '@/lib/types'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export function HistoryPage() {
  const sessionsQuery = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api<SessionSummary[]>('/sessions'),
  })
  const sessions = sessionsQuery.data ?? []

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="meta">The archive</p>
          <h1 className="font-serif font-normal text-[2.6rem] leading-[1.08] mt-2">
            Past sessions.
          </h1>
        </div>
        {sessions.length > 0 && (
          <Link to="/" className="no-underline hidden sm:block">
            <Button size="md">
              New session
              <ArrowRight size={14} strokeWidth={1.75} />
            </Button>
          </Link>
        )}
      </div>

      {sessionsQuery.isLoading && <p className="meta mt-10">Loading the archive…</p>}

      {!sessionsQuery.isLoading && sessions.length === 0 && (
        <div className="py-16 text-center">
          <p className="meta">Nothing on file</p>
          <p className="font-serif italic text-2xl mt-2 text-ink-soft">Begin your first session.</p>
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
        <ul className="mt-6">
          {sessions.map((s) => (
            <li key={s.id}>
              <Link
                to={s.status === 'completed' ? `/sessions/${s.id}` : `/interview/${s.id}`}
                className="no-underline grid grid-cols-[1fr_auto] gap-x-5 gap-y-1 items-baseline py-4 pl-4 border-l-2 border-line mb-1.5 hover:border-link hover:bg-panel/60 transition-colors"
              >
                <span className="text-[15px] text-ink line-clamp-1">
                  {roleLabel(s.job_posting, s.id)}
                </span>
                <span className="meta whitespace-nowrap">
                  {s.status === 'completed' ? 'Filed' : 'Open'}
                </span>
                <span className="meta col-span-2">{formatDate(s.created_at)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
