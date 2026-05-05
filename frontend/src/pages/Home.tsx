import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, NotebookPen } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Field'
import type { Question, SessionSummary } from '@/lib/types'

export function HomePage() {
  const { user } = useAuth()
  const nav = useNavigate()
  const qc = useQueryClient()
  const [posting, setPosting] = useState('')
  const [error, setError] = useState<string | null>(null)

  const sessionsQuery = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api<SessionSummary[]>('/sessions'),
  })

  const recent = sessionsQuery.data?.slice(0, 3) ?? []

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
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    },
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

  const charCount = posting.length

  return (
    <div className="max-w-6xl mx-auto px-6 lg:px-10 py-12 lg:py-16">
      <div className="grid lg:grid-cols-12 gap-12">
        {/* Lede column */}
        <div className="lg:col-span-5 space-y-7">
          <p className="mono-meta">No. 01 — Begin</p>
          <h1 className="display-serif text-5xl lg:text-6xl leading-[1.02]">
            Welcome,
            <br />
            <span className="italic text-accent">{user?.display_name?.split(' ')[0] ?? 'there'}.</span>
          </h1>
          <p className="text-lg leading-relaxed text-ink-soft max-w-prose">
            Paste a job posting on the right. Lens will compose five questions
            shaped to that role and hand them back to you, one at a time.
          </p>
          <div className="border-t border-rule pt-5 mono-meta">
            <span className="block">A few rules of the house</span>
            <ul className="mt-3 space-y-1.5 text-ink-soft normal-case tracking-normal text-sm">
              <li>— Five questions per session.</li>
              <li>— Skip what you can&rsquo;t answer.</li>
              <li>— Read the feedback slowly.</li>
            </ul>
          </div>
        </div>

        {/* Form column */}
        <form onSubmit={onSubmit} className="lg:col-span-7 space-y-6">
          <div className="flex items-center justify-between mono-meta">
            <span>The posting</span>
            <span>{charCount.toLocaleString()} ch.</span>
          </div>

          <Textarea
            label="Paste here"
            rows={14}
            placeholder={`Paste the full job posting…\n\nExample:\n\n"Backend Engineer (Co-op), Acme Inc.\nYou will work on Python services using FastAPI and PostgreSQL…"`}
            value={posting}
            onChange={(e) => setPosting(e.target.value)}
            error={error ?? undefined}
            hint="Longer postings yield more pointed questions."
          />

          <div className="flex items-center justify-end gap-4">
            <Button
              type="submit"
              size="lg"
              loading={startMutation.isPending}
              disabled={posting.trim().length < 20}
            >
              <NotebookPen size={16} strokeWidth={1.75} />
              Begin session
              <ArrowRight size={16} strokeWidth={1.75} />
            </Button>
          </div>

          {recent.length > 0 && (
            <div className="border-t border-rule pt-6 mt-10">
              <p className="mono-meta mb-4">Recently filed</p>
              <ul className="divide-y divide-rule-soft">
                {recent.map((s) => (
                  <li key={s.id} className="py-3 flex items-baseline justify-between gap-6">
                    <button
                      type="button"
                      onClick={() => nav(`/sessions/${s.id}`)}
                      className="text-left flex-1 min-w-0 cursor-pointer hover:text-accent"
                    >
                      <span className="font-mono text-[0.7rem] tracking-[0.14em] text-ink-mute mr-3 align-middle">
                        #{String(s.id).padStart(3, '0')}
                      </span>
                      <span className="display-serif text-lg leading-snug align-middle line-clamp-1">
                        {s.job_posting.slice(0, 90)}…
                      </span>
                    </button>
                    <span className="mono-meta whitespace-nowrap">
                      {s.status === 'completed' ? 'Filed' : 'Open'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
