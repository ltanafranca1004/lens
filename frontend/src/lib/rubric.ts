// The design's data logic, in one place: the four dimensions, their colors, and the derivations
// the screens need. Everything here reads the real rubric returned by the API (QuestionOut.rubric,
// each dim { score, evidence[], reasoning }) — no placeholder content.
import type { Question } from './types'

export type DimKey = 'completeness' | 'substance' | 'reasoning' | 'correctness'

export const DIMS: { key: DimKey; label: string; short: string }[] = [
  { key: 'completeness', label: 'Completeness', short: 'Compl.' },
  { key: 'substance', label: 'Substance density', short: 'Subst.' },
  { key: 'reasoning', label: 'Reasoning', short: 'Reas.' },
  { key: 'correctness', label: 'Correctness', short: 'Corr.' },
]

// Per-dimension hue (OKLCH). Highlight/legend swatches share one lightness+chroma; the card
// border sits darker. Matches the design's DIM_HUE map exactly.
const DIM_HUE: Record<DimKey, number> = {
  completeness: 250,
  substance: 88,
  reasoning: 152,
  correctness: 332,
}

export const markBg = (dim: DimKey) => `oklch(0.905 0.062 ${DIM_HUE[dim]})`
export const legendDot = (dim: DimKey) => `oklch(0.905 0.062 ${DIM_HUE[dim]})`
export const barColor = (dim: DimKey) => `oklch(0.62 0.075 ${DIM_HUE[dim]})`

export type Segment = { text: string; mark?: boolean; bg?: string }

// Strip surrounding quotes (straight or curly) and a trailing ellipsis (the mock evaluator appends
// one to its snippet). The real evaluator's quotes are already verified substrings of the answer.
function cleanPhrase(p: string): string {
  return p
    .replace(/^["'“‘\s]+/, '')
    .replace(/["'”’\s]+$/, '')
    .replace(/^(?:…|\.\.\.)\s*/, '')
    .replace(/\s*(?:…|\.\.\.)$/, '')
    .trim()
}

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

// Map each dimension's evidence phrase onto the answer text and wrap the matched run in that
// dimension's highlight color. Tolerant of case + whitespace differences (the backend filters
// evidence with the same normalization), and reports offsets back into the *original* text so the
// candidate reads exactly what they wrote. Non-overlapping; the earliest match wins a contested
// span. Returns a single plain segment when there is nothing to mark.
export function highlightSegments(answer: string, rubric: Question['rubric']): Segment[] {
  if (!answer) return [{ text: '' }]
  if (!rubric) return [{ text: answer }]

  const marks: { phrase: string; dim: DimKey }[] = []
  for (const { key } of DIMS) {
    for (const ev of rubric[key]?.evidence ?? []) {
      const phrase = cleanPhrase(ev)
      if (phrase) marks.push({ phrase, dim: key })
    }
  }
  if (marks.length === 0) return [{ text: answer }]

  // Build a whitespace-collapsed, lowercased copy of the answer alongside a map from each
  // normalized-char index back to its index in the original string.
  const normChars: string[] = []
  const originIndex: number[] = []
  let prevSpace = false
  for (let i = 0; i < answer.length; i++) {
    const ch = answer[i]
    if (/\s/.test(ch)) {
      if (!prevSpace && normChars.length > 0) {
        normChars.push(' ')
        originIndex.push(i)
      }
      prevSpace = true
    } else {
      normChars.push(ch.toLowerCase())
      originIndex.push(i)
      prevSpace = false
    }
  }
  const normAnswer = normChars.join('')

  type Hit = { start: number; end: number; dim: DimKey }
  const hits: Hit[] = []
  for (const { phrase, dim } of marks) {
    const normPhrase = normalize(phrase)
    if (!normPhrase) continue
    const at = normAnswer.indexOf(normPhrase)
    if (at < 0) continue
    hits.push({
      start: originIndex[at],
      end: originIndex[at + normPhrase.length - 1] + 1,
      dim,
    })
  }
  if (hits.length === 0) return [{ text: answer }]
  hits.sort((a, b) => a.start - b.start)

  const out: Segment[] = []
  let pos = 0
  for (const hit of hits) {
    if (hit.start < pos) continue // overlaps an earlier mark — skip
    if (hit.start > pos) out.push({ text: answer.slice(pos, hit.start) })
    out.push({ text: answer.slice(hit.start, hit.end), mark: true, bg: markBg(hit.dim) })
    pos = hit.end
  }
  if (pos < answer.length) out.push({ text: answer.slice(pos) })
  return out
}

const dimScores = (rubric: Question['rubric']): Partial<Record<DimKey, number>> => {
  const out: Partial<Record<DimKey, number>> = {}
  if (!rubric) return out
  for (const { key } of DIMS) {
    const s = rubric[key]?.score
    if (typeof s === 'number') out[key] = s
  }
  return out
}

// A one-line verdict for an answer, from real data only. When correctness held the overall score
// below the four-dimension average, state that fact (the score cap is derived, not invented);
// otherwise surface the weakest dimension's own reasoning sentence.
export function deriveVerdict(question: Question): string {
  const rubric = question.rubric
  if (!rubric) return ''
  const scores = dimScores(rubric)
  const values = Object.values(scores)
  if (values.length === 0) return ''

  // A weak *central* dimension (correctness or completeness) caps the overall below the raw
  // average; when it did, say so explicitly so the number and the words agree. Mirrors
  // _combine_overall in app/llm.py. Completeness wins ties — "did you answer the question" is the
  // signal a student most needs to hear.
  const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length)
  if (typeof question.score === 'number') {
    const ceiling = (s?: number) => (s === 1 ? 2 : s === 2 ? 3 : 5)
    const compCap = ceiling(scores.completeness)
    const corrCap = ceiling(scores.correctness)
    if (avg > Math.min(compCap, corrCap)) {
      return compCap <= corrCap
        ? `Completeness held this to ${question.score} of 5 — an answer that doesn’t fully address the question caps the score, however strong the rest.`
        : `Correctness held this to ${question.score} of 5 — a weak central claim caps the whole answer, however strong the rest.`
    }
  }

  let weakest: DimKey | null = null
  let min = Infinity
  for (const { key } of DIMS) {
    const s = scores[key]
    if (typeof s === 'number' && s < min) {
      min = s
      weakest = key
    }
  }
  return (weakest && rubric[weakest]?.reasoning) || ''
}

export type DimAverage = { key: DimKey; label: string; avg: number }

// Average each dimension across the session's answered (non-skipped, rubric-carrying) questions,
// plus the steadiest and thinnest dimensions — for the summary's opening line.
export function dimensionAverages(questions: Question[]): {
  averages: DimAverage[]
  steadiest: DimAverage | null
  thinnest: DimAverage | null
} {
  const answered = questions.filter((q) => !q.skipped && q.rubric)
  const averages: DimAverage[] = []
  for (const { key, label } of DIMS) {
    const vals = answered
      .map((q) => q.rubric?.[key]?.score)
      .filter((s): s is number => typeof s === 'number')
    if (vals.length) averages.push({ key, label, avg: vals.reduce((a, b) => a + b, 0) / vals.length })
  }
  if (averages.length === 0) return { averages, steadiest: null, thinnest: null }
  const sorted = [...averages].sort((a, b) => b.avg - a.avg)
  return { averages, steadiest: sorted[0], thinnest: sorted[sorted.length - 1] }
}

// The backend stores only the full job posting, no role title. Use its first non-empty line as a
// short label, falling back to the session number.
export function roleLabel(jobPosting: string, id: number): string {
  const firstLine = jobPosting
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean)
  if (!firstLine) return `Session #${String(id).padStart(3, '0')}`
  return firstLine.length > 52 ? firstLine.slice(0, 50).trimEnd() + '…' : firstLine
}
