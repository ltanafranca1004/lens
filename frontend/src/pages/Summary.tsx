import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, RotateCcw } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { MarkedUpText } from '@/components/MarkedUpText'
import { AnswerFeedback } from '@/components/AnswerFeedback'
import { DIMS, dimensionAverages, legendDot, roleLabel } from '@/lib/rubric'
import type { SessionDetail } from '@/lib/types'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 mt-5">
      {DIMS.map(({ key, label }) => (
        <span key={key} className="flex items-center gap-2 text-[12.5px] text-ink-soft">
          <span className="w-4 h-[11px] rounded-[1px]" style={{ background: legendDot(key) }} />
          {label}
        </span>
      ))}
    </div>
  )
}

function excerptOf(answer: string) {
  return answer.length > 260 ? answer.slice(0, 258).trimEnd() + '…' : answer
}

export function SummaryPage() {
  const { id } = useParams<{ id: string }>()
  const sessionId = Number(id)
  const [openId, setOpenId] = useState<number | null>(null)

  const sessionQuery = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => api<SessionDetail>(`/sessions/${sessionId}`),
    enabled: Number.isFinite(sessionId),
  })

  if (sessionQuery.isLoading) return <p className="meta">Loading…</p>
  if (!sessionQuery.data) {
    return (
      <div>
        <p className="meta">Error</p>
        <p className="mt-3 text-ink-soft">This session can&rsquo;t be loaded.</p>
      </div>
    )
  }

  const s = sessionQuery.data
  const sorted = [...s.questions].sort((a, b) => a.order_index - b.order_index)
  const role = roleLabel(s.job_posting, s.id)
  const avg = s.average_score
  const { steadiest, thinnest } = dimensionAverages(sorted)
  const indexOfId = (qid: number) => sorted.findIndex((q) => q.id === qid) + 1

  // Expanded single-answer view (design 3d, reached from a summary row).
  const open = openId !== null ? sorted.find((q) => q.id === openId) : undefined
  if (open) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpenId(null)}
          className="text-[13px] text-link hover:text-ink cursor-pointer"
        >
          ← back to all five
        </button>
        <p className="meta mt-6">Question {indexOfId(open.id)} of {sorted.length}</p>
        <h2 className="font-serif font-normal text-[1.8rem] leading-[1.25] mt-2 max-w-[44ch]">
          {open.question_text}
        </h2>
        <div className="mt-6">
          <AnswerFeedback question={open} />
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 meta">
        <span>Session {s.id} · {role}</span>
        <span>{formatDate(s.created_at)}{avg !== null && ` · ${avg.toFixed(1)} of 5`}</span>
      </div>

      <h1 className="font-serif font-normal text-[2.6rem] sm:text-[2.9rem] leading-[1.08] mt-4">
        Your own words, marked up.
      </h1>
      <p className="text-[15px] leading-[1.6] text-ink-soft max-w-[58ch] mt-3 [text-wrap:pretty]">
        Every score points at a phrase you actually wrote.
        {steadiest && thinnest && steadiest.key !== thinnest.key && (
          <>
            {' '}Steadiest here is {steadiest.label.toLowerCase()} at {steadiest.avg.toFixed(1)};{' '}
            {thinnest.label.toLowerCase()}, at {thinnest.avg.toFixed(1)}, is where these answers thin
            out.
          </>
        )}
      </p>

      <Legend />

      {s.status === 'in_progress' && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 bg-panel px-5 py-4 rounded-sm">
          <p className="text-[14px] text-ink-soft">
            This session is still open — you can pick up where you left off.
          </p>
          <Link to={`/interview/${s.id}`} className="no-underline shrink-0">
            <Button size="md">
              Continue answering
              <ArrowRight size={15} strokeWidth={1.75} />
            </Button>
          </Link>
        </div>
      )}

      <div className="mt-7">
        {sorted.map((q) => {
          if (q.skipped) {
            return (
              <div key={q.id} className="py-5 pl-[22px] border-l-2 border-line mb-1.5">
                <span className="text-[14px] font-medium text-ink-soft line-clamp-2">
                  {q.question_text}
                </span>
                <p className="font-serif italic text-ink/55 mt-2">Set aside.</p>
              </div>
            )
          }
          if (q.user_answer === null) return null
          return (
            <button
              key={q.id}
              type="button"
              onClick={() => setOpenId(q.id)}
              className="w-full text-left py-5 pl-[22px] pr-4 border-l-2 border-line mb-1.5 cursor-pointer hover:border-link hover:bg-panel/60 transition-colors"
            >
              <div className="flex items-baseline justify-between gap-6">
                <span className="text-[14px] font-medium text-ink-soft leading-snug max-w-[70ch] line-clamp-2 [text-wrap:pretty]">
                  {q.question_text}
                </span>
                <span className="font-serif text-[1.35rem] whitespace-nowrap text-ink-soft">
                  {q.score}
                  <span className="text-[13px] text-ink/55"> of 5</span>
                </span>
              </div>
              <p className="font-serif text-[1.1rem] leading-[1.72] mt-2.5 text-ink [text-wrap:pretty]">
                <MarkedUpText answer={excerptOf(q.user_answer)} rubric={q.rubric} />
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
                {DIMS.map(({ key, label }) => {
                  const dim = q.rubric?.[key]
                  if (!dim) return null
                  return (
                    <span key={key} className="flex items-center gap-1.5 text-[12.5px] text-ink-soft">
                      <span className="w-[9px] h-[9px] rounded-[1px]" style={{ background: legendDot(key) }} />
                      {label} {dim.score}
                    </span>
                  )
                })}
              </div>
            </button>
          )
        })}
      </div>

      {s.study_note && (
        <section className="mt-7 bg-panel px-6 py-5 rounded-sm">
          <p className="text-[13px] font-semibold">What to study next</p>
          <p className="font-serif text-[1.15rem] leading-[1.62] mt-2 max-w-[70ch] [text-wrap:pretty]">
            {s.study_note}
          </p>
        </section>
      )}

      <div className="mt-10 pt-6 border-t border-line flex items-center justify-between">
        <Link to="/history" className="meta hover:text-ink no-underline flex items-center gap-2">
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
