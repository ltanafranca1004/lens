import { MarkedUpText } from '@/components/MarkedUpText'
import { DIMS, barColor, deriveVerdict } from '@/lib/rubric'
import type { Question } from '@/lib/types'

// The per-answer feedback block (design 3d): the marked-up answer, the overall score with a derived
// verdict, and one card per dimension (score + reasoning, and a pointer to the highlighted phrase
// when that dimension cited evidence). Reused in-session (Interview) and expanded from the summary.
export function AnswerFeedback({ question }: { question: Question }) {
  const rubric = question.rubric
  const verdict = deriveVerdict(question)

  return (
    <div>
      <p className="font-serif text-[1.25rem] leading-[1.78] text-ink [text-wrap:pretty]">
        <MarkedUpText answer={question.user_answer ?? ''} rubric={rubric} />
      </p>

      <div className="flex items-baseline gap-3 mt-7 pt-5 border-t border-line">
        <span className="font-serif text-[2.4rem] leading-none whitespace-nowrap">
          {question.score}
          <span className="text-base text-ink/55"> of 5</span>
        </span>
        {verdict && (
          <span className="text-[15px] leading-snug text-ink-soft max-w-[46ch]">{verdict}</span>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-x-6 mt-5">
        {DIMS.map(({ key, label }) => {
          const entry = rubric?.[key]
          if (!entry) return null
          return (
            <div
              key={key}
              className="py-4 pl-4"
              style={{ borderLeft: `3px solid ${barColor(key)}` }}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[15px] font-medium">{label}</span>
                <span className="font-serif text-xl">{entry.score}</span>
              </div>
              <p className="text-[14.5px] leading-relaxed mt-2 text-ink-soft [text-wrap:pretty]">
                {entry.reasoning}
              </p>
              {entry.evidence.length > 0 && (
                <p className="text-[13px] leading-snug mt-1.5 text-ink/55">
                  Weighing the phrase highlighted above.
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
