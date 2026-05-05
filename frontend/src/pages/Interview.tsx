import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, SkipForward, ChevronRight } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Field'
import type { Question, SessionDetail } from '@/lib/types'

function ScoreGlyph({ score }: { score: number }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        className="font-mono text-[3.4rem] leading-none text-accent"
        style={{ fontVariationSettings: '"wght" 600' }}
      >
        {String(score).padStart(2, '0')}
      </span>
      <span className="font-mono text-base text-ink-mute">/05</span>
    </div>
  )
}

export function InterviewPage() {
  const { id } = useParams<{ id: string }>()
  const sessionId = Number(id)
  const nav = useNavigate()
  const qc = useQueryClient()

  const sessionQuery = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => api<SessionDetail>(`/sessions/${sessionId}`),
    enabled: Number.isFinite(sessionId),
  })

  const questions = useMemo(() => {
    const list = sessionQuery.data?.questions ?? []
    return [...list].sort((a, b) => a.order_index - b.order_index)
  }, [sessionQuery.data])

  // Find first unanswered, non-skipped question. If all are done, point to last.
  const initialIndex = useMemo(() => {
    const idx = questions.findIndex((q) => !q.skipped && q.user_answer === null)
    return idx === -1 ? Math.max(questions.length - 1, 0) : idx
  }, [questions])

  const [cursor, setCursor] = useState(0)
  useEffect(() => setCursor(initialIndex), [initialIndex])

  const current = questions[cursor]
  const total = questions.length

  const [answer, setAnswer] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setAnswer('')
    setError(null)
  }, [cursor])

  const answerMutation = useMutation({
    mutationFn: (text: string) =>
      api<Question>(`/sessions/${sessionId}/questions/${current.id}/answer`, {
        method: 'POST',
        body: { answer: text },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['session', sessionId] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Something went wrong'),
  })

  const skipMutation = useMutation({
    mutationFn: () =>
      api<Question>(`/sessions/${sessionId}/questions/${current.id}/skip`, {
        method: 'POST',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['session', sessionId] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Something went wrong'),
  })

  const completeMutation = useMutation({
    mutationFn: () => api<SessionDetail>(`/sessions/${sessionId}`, { method: 'PATCH' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['session', sessionId] })
      qc.invalidateQueries({ queryKey: ['sessions'] })
      nav(`/sessions/${sessionId}`)
    },
  })

  if (sessionQuery.isLoading) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-24 mono-meta">Loading question…</div>
    )
  }
  if (sessionQuery.error || !current) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-24">
        <p className="mono-meta">Error</p>
        <p className="mt-3">This session can&rsquo;t be loaded.</p>
      </div>
    )
  }

  const isAnswered = current.user_answer !== null || current.skipped
  const allDone = questions.every((q) => q.user_answer !== null || q.skipped)
  const isLast = cursor === total - 1

  return (
    <div className="max-w-3xl mx-auto px-6 lg:px-10 py-12 lg:py-16">
      {/* Folio bar — paginates within the session */}
      <div className="flex items-center justify-between mono-meta border-b border-rule pb-3">
        <span>
          Question {String(cursor + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
        </span>
        <div className="flex items-center gap-1.5">
          {questions.map((q, i) => {
            const state =
              q.user_answer !== null
                ? 'answered'
                : q.skipped
                  ? 'skipped'
                  : i === cursor
                    ? 'current'
                    : 'pending'
            return (
              <button
                key={q.id}
                type="button"
                onClick={() => setCursor(i)}
                aria-label={`Go to question ${i + 1}`}
                className={`w-3 h-3 rounded-full cursor-pointer transition ${
                  state === 'answered'
                    ? 'bg-accent'
                    : state === 'skipped'
                      ? 'bg-ink-mute'
                      : state === 'current'
                        ? 'ring-1 ring-ink ring-offset-2 ring-offset-paper bg-paper'
                        : 'bg-rule'
                }`}
              />
            )
          })}
        </div>
      </div>

      {/* Question */}
      <article className="mt-12">
        <p className="mono-meta">The question</p>
        <h1
          key={current.id}
          className="display-serif text-3xl lg:text-[2.8rem] leading-[1.12] mt-4 text-ink animate-[fade-in_500ms_ease]"
        >
          {current.question_text}
        </h1>
      </article>

      {/* Answer area or feedback panel */}
      {!isAnswered && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (answer.trim().length === 0) {
              setError('Write something first, or skip.')
              return
            }
            answerMutation.mutate(answer)
          }}
          className="mt-10 space-y-6"
        >
          <Textarea
            label="Your answer"
            rows={10}
            placeholder="Take your time. Walk through it like you would in a real interview."
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            error={error ?? undefined}
            hint="Tip: situation → action → result."
          />
          <div className="flex items-center justify-between gap-4">
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={() => skipMutation.mutate()}
              loading={skipMutation.isPending}
            >
              <SkipForward size={14} strokeWidth={1.75} />
              Skip this one
            </Button>
            <Button type="submit" size="lg" loading={answerMutation.isPending}>
              Submit answer
              <ArrowRight size={16} strokeWidth={1.75} />
            </Button>
          </div>
        </form>
      )}

      {isAnswered && current.skipped && (
        <div className="mt-12 border-t border-rule pt-8">
          <p className="mono-meta">Skipped</p>
          <p className="display-serif text-xl mt-3 text-ink-soft italic">
            You set this one aside. That&rsquo;s allowed.
          </p>
        </div>
      )}

      {isAnswered && !current.skipped && current.score !== null && (
        <div className="mt-12 border-t border-rule pt-8 grid sm:grid-cols-12 gap-10">
          <div className="sm:col-span-3">
            <p className="mono-meta">Score</p>
            <div className="mt-3">
              <ScoreGlyph score={current.score} />
            </div>
          </div>
          <div className="sm:col-span-9 space-y-6">
            <div>
              <p className="mono-meta">Your answer</p>
              <p className="mt-3 text-base leading-relaxed text-ink-soft whitespace-pre-wrap">
                {current.user_answer}
              </p>
            </div>
            <div>
              <p className="mono-meta">Field notes</p>
              <p className="display-serif text-lg leading-relaxed mt-3 text-ink">
                {current.ai_feedback}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Footer nav */}
      <div className="mt-14 pt-6 border-t border-rule flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          disabled={cursor === 0}
          onClick={() => setCursor((c) => Math.max(0, c - 1))}
        >
          ← Previous
        </Button>

        {!isLast && isAnswered && (
          <Button size="md" onClick={() => setCursor((c) => Math.min(total - 1, c + 1))}>
            Next question
            <ChevronRight size={16} strokeWidth={1.75} />
          </Button>
        )}

        {isLast && allDone && (
          <Button
            size="md"
            onClick={() => completeMutation.mutate()}
            loading={completeMutation.isPending}
          >
            Close the session
            <ArrowRight size={16} strokeWidth={1.75} />
          </Button>
        )}
      </div>
    </div>
  )
}
