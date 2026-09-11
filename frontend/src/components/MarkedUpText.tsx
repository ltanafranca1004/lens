import { highlightSegments } from '@/lib/rubric'
import type { Question } from '@/lib/types'

// Renders an answer with each dimension's evidence phrase highlighted in that dimension's color —
// the interaction at the heart of the redesign. All highlighted runs are real evidence strings
// from the rubric, matched onto the candidate's own text.
export function MarkedUpText({
  answer,
  rubric,
}: {
  answer: string
  rubric: Question['rubric']
}) {
  const segments = highlightSegments(answer, rubric)
  return (
    <>
      {segments.map((seg, i) =>
        seg.mark ? (
          <span key={i} style={{ background: seg.bg, padding: '1px 3px' }}>
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  )
}
