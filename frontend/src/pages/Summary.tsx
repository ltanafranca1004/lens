import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, RotateCcw } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import type { SessionDetail } from '@/lib/types'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function SummaryPage() {
  const { id } = useParams<{ id: string }>()
  const sessionId = Number(id)

  const sessionQuery = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => api<SessionDetail>(`/sessions/${sessionId}`),
    enabled: Number.isFinite(sessionId),
  })

  if (sessionQuery.isLoading) {
    return <div className="max-w-4xl mx-auto px-6 py-24 mono-meta">Loading…</div>
  }
  if (!sessionQuery.data) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-24">
        <p className="mono-meta">Error</p>
        <p className="mt-3">This session can&rsquo;t be loaded.</p>
      </div>
    )
  }

  const s = sessionQuery.data
  const sorted = [...s.questions].sort((a, b) => a.order_index - b.order_index)
  const answered = sorted.filter((q) => q.user_answer !== null && !q.skipped)
  const skipped = sorted.filter((q) => q.skipped)
  const avg = s.average_score
  const isFiled = s.status === 'completed'

  return (
    <div className="max-w-4xl mx-auto px-6 lg:px-10 py-12 lg:py-16">
      {/* Folio */}
      <div className="flex items-center justify-between mono-meta border-b border-rule pb-3">
        <span>
          Session #{String(s.id).padStart(3, '0')} · {isFiled ? 'Filed' : 'Open'}
        </span>
        <span>{formatDate(s.created_at)}</span>
      </div>

      {/* Headline */}
      <header className="mt-12 grid lg:grid-cols-12 gap-10">
        <div className="lg:col-span-8">
          <p className="mono-meta">A session in review</p>
          <h1 className="display-serif text-5xl lg:text-6xl leading-[1.02] mt-4">
            <span className="italic text-accent">Five</span> questions,
            <br />
            quietly examined.
          </h1>
          <p className="mt-6 text-base leading-relaxed text-ink-soft max-w-prose">
            {s.job_posting.length > 240
              ? s.job_posting.slice(0, 240) + '…'
              : s.job_posting}
          </p>
        </div>
        <aside className="lg:col-span-4 border-l border-rule lg:pl-8">
          <p className="mono-meta">Average</p>
          {avg !== null ? (
            <div className="mt-3 flex items-baseline gap-2">
              <span className="font-mono text-[3.6rem] leading-none text-accent">
                {avg.toFixed(1)}
              </span>
              <span className="font-mono text-base text-ink-mute">/05</span>
            </div>
          ) : (
            <p className="mt-3 display-serif text-2xl text-ink-soft italic">No marks yet.</p>
          )}
          <dl className="mt-8 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="mono-meta">Answered</dt>
              <dd className="font-mono">{String(answered.length).padStart(2, '0')}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="mono-meta">Skipped</dt>
              <dd className="font-mono">{String(skipped.length).padStart(2, '0')}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="mono-meta">Total</dt>
              <dd className="font-mono">{String(sorted.length).padStart(2, '0')}</dd>
            </div>
          </dl>
        </aside>
      </header>

      {/* Per-question recap */}
      <section className="mt-16 space-y-12">
        {sorted.map((q, i) => (
          <article key={q.id} className="grid lg:grid-cols-12 gap-8 border-t border-rule pt-8">
            <div className="lg:col-span-2 mono-meta">Q {String(i + 1).padStart(2, '0')}</div>
            <div className="lg:col-span-10 space-y-6">
              <h2 className="display-serif text-2xl leading-snug text-ink">
                {q.question_text}
              </h2>

              {q.skipped && (
                <p className="display-serif italic text-ink-soft">Set aside.</p>
              )}

              {!q.skipped && q.user_answer && (
                <>
                  <div className="grid sm:grid-cols-12 gap-6">
                    <div className="sm:col-span-3">
                      <p className="mono-meta">Score</p>
                      <div className="mt-2 flex items-baseline gap-1.5">
                        <span className="font-mono text-3xl text-accent">
                          {String(q.score ?? 0).padStart(2, '0')}
                        </span>
                        <span className="font-mono text-sm text-ink-mute">/05</span>
                      </div>
                    </div>
                    <div className="sm:col-span-9">
                      <p className="mono-meta">Your answer</p>
                      <p className="mt-2 text-sm leading-relaxed text-ink-soft whitespace-pre-wrap">
                        {q.user_answer}
                      </p>
                    </div>
                  </div>
                  <div>
                    <p className="mono-meta">Field notes</p>
                    <p className="display-serif text-lg leading-relaxed mt-2 text-ink">
                      {q.ai_feedback}
                    </p>
                  </div>
                </>
              )}
            </div>
          </article>
        ))}
      </section>

      {/* Footer actions */}
      <div className="mt-16 pt-6 border-t border-rule flex items-center justify-between">
        <Link to="/history" className="mono-meta no-underline hover:text-ink flex items-center gap-2">
          <ArrowLeft size={14} strokeWidth={1.75} /> Archive
        </Link>
        <Link to="/" className="no-underline">
          <Button size="md">
            <RotateCcw size={14} strokeWidth={1.75} />
            New session
          </Button>
        </Link>
      </div>
    </div>
  )
}
