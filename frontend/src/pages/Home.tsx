import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Field'
import { roleLabel } from '@/lib/rubric'
import type { Question, SessionSummary } from '@/lib/types'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}

export function HomePage() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const [posting, setPosting] = useState('')
  const [error, setError] = useState<string | null>(null)

  const sessionsQuery = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api<SessionSummary[]>('/sessions'),
  })
  const recent = sessionsQuery.data?.slice(0, 4) ?? []

  const startMutation = useMutation({
    mutationFn: async (jobPosting: string) => {
      const session = await api<SessionSummary>('/sessions', {
        method: 'POST',
        body: { job_posting: jobPosting },
      })
      await api<Question[]>(`/sessions/${session.id}/questions`, { method: 'POST' })
      return session
    },
    onSuccess: (session) => {
      qc.invalidateQueries({ queryKey: ['sessions'] })
      nav(`/interview/${session.id}`)
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Something went wrong'),
  })

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (posting.trim().length < 20) {
      setError('Paste a real job posting — at least 20 characters.')
      return
    }
    startMutation.mutate(posting)
  }

  return (
    <div>
      <h1 className="font-serif font-normal text-[2.6rem] sm:text-[2.9rem] leading-[1.08] max-w-[18ch]">
        What are you interviewing for?
      </h1>
      <p className="text-[15.5px] leading-[1.62] text-ink-soft max-w-[58ch] mt-3 [text-wrap:pretty]">
        Paste the posting and Lens writes five questions shaped to that role. You type your answers,
        one at a time, and get the reasoning behind every score.
      </p>

      <form onSubmit={onSubmit} className="mt-8">
        <Textarea
          label="The posting"
          hint="Longer postings make sharper questions."
          rows={12}
          placeholder={
            'Backend Engineer (Co-op), Acme Inc.\n\nYou will work on Python services using FastAPI and PostgreSQL…'
          }
          value={posting}
          onChange={(e) => setPosting(e.target.value)}
          error={error ?? undefined}
        />
        <div className="flex items-center justify-between gap-4 mt-5">
          <span className="meta hidden sm:inline">
            Five questions · no timer · leave any one unanswered
          </span>
          <Button type="submit" size="lg" loading={startMutation.isPending}>
            Begin session
            <ArrowRight size={16} strokeWidth={1.75} />
          </Button>
        </div>
      </form>

      {recent.length > 0 && (
        <section className="mt-11">
          <p className="meta">Earlier sessions</p>
          <ul className="mt-2">
            {recent.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => nav(`/sessions/${s.id}`)}
                  className="w-full text-left grid grid-cols-[1fr_auto] gap-x-5 gap-y-1 items-baseline py-3.5 pl-4 border-l-2 border-line cursor-pointer hover:border-link hover:bg-panel/50 transition-colors"
                >
                  <span className="text-[14.5px] text-ink line-clamp-1">
                    {roleLabel(s.job_posting, s.id)}
                  </span>
                  <span className="meta whitespace-nowrap">
                    {s.status === 'completed' ? 'Filed' : 'Open'}
                  </span>
                  <span className="meta col-span-2">{formatDate(s.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
