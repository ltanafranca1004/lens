import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Field'
import { AnswerFeedback } from '@/components/AnswerFeedback'
import { roleLabel } from '@/lib/rubric'
import type { Question, SessionDetail } from '@/lib/types'

const draftKey = (sessionId: number, questionId: number) => `lens.draft.${sessionId}.${questionId}`

function readDraft(sessionId: number, questionId: number): string {
  try {
    return localStorage.getItem(draftKey(sessionId, questionId)) ?? ''
  } catch {
    return ''
  }
}

function ProgressTicks({ questions, cursor }: { questions: Question[]; cursor: number }) {
  return (
    <span className="flex gap-1.5">
      {questions.map((q, i) => {
        const done = q.user_answer !== null || q.skipped
        const now = i === cursor
        return (
          <span
            key={q.id}
            className="block h-1 w-6 rounded-full"
            style={{
              background: done || now ? 'oklch(0.5 0.05 250)' : 'oklch(0.22 0.015 250 / 0.13)',
              opacity: now && !done ? 0.55 : 1,
            }}
          />
        )
      })}
    </span>
  )
}

// The answering form (design 3b). Keyed on the question id by the parent, so its draft state
// initializes cleanly per question with no state-sync effect.
function AnswerForm({
  sessionId,
  question,
  scoring,
  skipping,
  serverError,
  onSubmit,
  onSkip,
}: {
  sessionId: number
  question: Question
  scoring: boolean
  skipping: boolean
  serverError: string | null
  onSubmit: (text: string) => void
  onSkip: () => void
}) {
  const [answer, setAnswer] = useState(() => readDraft(sessionId, question.id))
  const [localError, setLocalError] = useState<string | null>(null)

  const onChange = (value: string) => {
    setAnswer(value)
    if (localError) setLocalError(null)
    try {
      localStorage.setItem(draftKey(sessionId, question.id), value)
    } catch {
      /* storage unavailable — keep the in-memory draft */
    }
  }

  const words = answer.trim() ? answer.trim().split(/\s+/).length : 0

  return (
    <>
      <p className="text-[14.5px] leading-[1.6] text-ink/60 mt-3 max-w-[58ch]">
        Write it the way you&rsquo;d say it out loud. Length isn&rsquo;t the point — one clear reason
        beats three claims.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (answer.trim().length === 0) {
            setLocalError('Write something first, or skip.')
            return
          }
          onSubmit(answer)
        }}
        className="mt-6"
      >
        <Textarea
          label="Your answer"
          rows={9}
          placeholder="Take your time. Walk through it like you would in a real interview."
          value={answer}
          onChange={(e) => onChange(e.target.value)}
          error={localError ?? serverError ?? undefined}
          disabled={scoring || skipping}
        />
        <div className="flex items-center justify-between gap-4 mt-4">
          <span className="meta">
            {words} {words === 1 ? 'word' : 'words'} · saved as you type
          </span>
          {scoring ? (
            <span className="text-[15px] text-ink-soft animate-[fade-in_300ms_ease]">
              Lens is scoring your answer…
            </span>
          ) : (
            <span className="flex items-center gap-5">
              <Button type="button" variant="ghost" size="md" onClick={onSkip} loading={skipping}>
                Skip this one
              </Button>
              <Button type="submit" size="lg" disabled={skipping}>
                Submit answer
                <ArrowRight size={16} strokeWidth={1.75} />
              </Button>
            </span>
          )}
        </div>
      </form>

      <p className="text-[13px] leading-[1.6] text-ink/50 mt-7 max-w-[66ch]">
        Once you submit, Lens scores this answer on completeness, substance, reasoning and
        correctness — and shows you the phrase behind each one. You can&rsquo;t edit it afterwards,
        the same way you can&rsquo;t in the room.
      </p>
    </>
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

  // First unanswered, non-skipped question; if all are done, land on the last.
  const initialIndex = useMemo(() => {
    const idx = questions.findIndex((q) => !q.skipped && q.user_answer === null)
    return idx === -1 ? Math.max(questions.length - 1, 0) : idx
  }, [questions])

  // Set the resume point once per session, when it first loads. Thereafter the cursor is entirely
  // user-driven (Previous/Next) — submitting keeps it in place so the feedback stays on screen.
  // Tracking the session it was resumed for (not a bare boolean) re-applies initialIndex when the
  // route param changes, since /interview/:id reuses this component across sessions.
  const [cursor, setCursor] = useState(0)
  const [resumedFor, setResumedFor] = useState<number | null>(null)
  if (resumedFor !== sessionId && questions.length > 0) {
    setResumedFor(sessionId)
    setCursor(initialIndex)
  }

  const current = questions[cursor]

  const clearDraft = (questionId: number) => {
    try {
      localStorage.removeItem(draftKey(sessionId, questionId))
    } catch {
      /* ignore */
    }
  }

  const answerMutation = useMutation({
    mutationFn: (text: string) =>
      api<Question>(`/sessions/${sessionId}/questions/${current.id}/answer`, {
        method: 'POST',
        body: { answer: text },
        timeoutMs: 60_000, // real evaluation calls Groq; give it room
      }),
    onSuccess: () => {
      clearDraft(current.id)
      qc.invalidateQueries({ queryKey: ['session', sessionId] })
    },
  })

  const skipMutation = useMutation({
    mutationFn: () =>
      api<Question>(`/sessions/${sessionId}/questions/${current.id}/skip`, { method: 'POST' }),
    onSuccess: () => {
      clearDraft(current.id)
      qc.invalidateQueries({ queryKey: ['session', sessionId] })
    },
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
    return <p className="meta">Loading the session…</p>
  }
  if (sessionQuery.error || !current) {
    return (
      <div>
        <p className="meta">Error</p>
        <p className="mt-3 text-ink-soft">This session can&rsquo;t be loaded.</p>
      </div>
    )
  }

  const total = questions.length
  const role = roleLabel(sessionQuery.data!.job_posting, sessionId)
  const isAnswered = current.user_answer !== null || current.skipped
  const allDone = questions.every((q) => q.user_answer !== null || q.skipped)
  const isLast = cursor === total - 1
  const submitError =
    answerMutation.error instanceof ApiError
      ? answerMutation.error.message
      : answerMutation.error
        ? 'Something went wrong'
        : skipMutation.error instanceof ApiError
          ? skipMutation.error.message
          : skipMutation.error
            ? 'Something went wrong'
            : null

  return (
    <div>
      {/* Folio + progress */}
      <div className="flex items-center justify-between gap-4">
        <span className="meta">
          Question {cursor + 1} of {total} · {role}
        </span>
        <ProgressTicks questions={questions} cursor={cursor} />
      </div>

      {/* Question */}
      <h2
        key={current.id}
        className="font-serif font-normal text-[2rem] leading-[1.24] mt-5 max-w-[40ch] animate-[fade-in_500ms_ease]"
      >
        {current.question_text}
      </h2>

      {/* Answering (3b) */}
      {!isAnswered && (
        <AnswerForm
          key={current.id}
          sessionId={sessionId}
          question={current}
          scoring={answerMutation.isPending}
          skipping={skipMutation.isPending}
          serverError={submitError}
          onSubmit={(text) => answerMutation.mutate(text)}
          onSkip={() => skipMutation.mutate()}
        />
      )}

      {/* Skipped */}
      {isAnswered && current.skipped && (
        <div className="mt-8 border-t border-line pt-7">
          <p className="meta">Set aside</p>
          <p className="font-serif italic text-xl mt-2 text-ink-soft">
            You set this one aside. That&rsquo;s allowed.
          </p>
        </div>
      )}

      {/* Feedback (3d) */}
      {isAnswered && !current.skipped && current.score !== null && (
        <div className="mt-7">
          <AnswerFeedback question={current} />
        </div>
      )}

      {/* Footer nav */}
      <div className="mt-11 pt-6 border-t border-line flex items-center justify-between">
        <button
          type="button"
          disabled={cursor === 0}
          onClick={() => setCursor((c) => Math.max(0, c - 1))}
          className="meta hover:text-ink cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ← Previous
        </button>

        {!isLast && isAnswered && (
          <Button size="md" onClick={() => setCursor((c) => Math.min(total - 1, c + 1))}>
            Next question
            <ArrowRight size={15} strokeWidth={1.75} />
          </Button>
        )}

        {isLast && allDone && (
          <Button size="md" onClick={() => completeMutation.mutate()} loading={completeMutation.isPending}>
            Close the session
            <ArrowRight size={15} strokeWidth={1.75} />
          </Button>
        )}
      </div>
    </div>
  )
}
