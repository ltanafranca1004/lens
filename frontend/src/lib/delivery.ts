// Delivery metrics for voice answers — speaking pace and filler-word count. Computed entirely on the
// client from the transcript + recording time, shown in a separate, explicitly UNSCORED panel, and
// never sent to the backend. Scoring stays content-only: the four rubric dimensions judge what was
// said, not how it was delivered.

export type DeliveryMetrics = {
  words: number
  fillerCount: number
  wordsPerMinute: number | null // null when the recording couldn't be timed
}

// Common English hesitation/filler markers, word-boundary matched, case-insensitive. Deliberately
// conservative: this feeds an informational panel, so the odd false positive ("like"/"actually" in
// genuine use) is acceptable and never touches the score.
const FILLERS = [
  'um',
  'umm',
  'uh',
  'uhh',
  'er',
  'erm',
  'ah',
  'hmm',
  'like',
  'you know',
  'i mean',
  'sort of',
  'kind of',
  'basically',
  'actually',
  'literally',
]
const FILLER_RE = new RegExp(`\\b(?:${FILLERS.map((f) => f.replace(/ /g, '\\s+')).join('|')})\\b`, 'gi')

export function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

export function countFillers(text: string): number {
  const matches = text.match(FILLER_RE)
  return matches ? matches.length : 0
}

export function computeDelivery(transcript: string, elapsedMs: number): DeliveryMetrics {
  const words = countWords(transcript)
  const minutes = elapsedMs > 0 ? elapsedMs / 60000 : 0
  return {
    words,
    fillerCount: countFillers(transcript),
    wordsPerMinute: minutes > 0 ? Math.round(words / minutes) : null,
  }
}

// Persisted alongside the answer draft (see draftKey in Interview.tsx) so the delivery panel survives
// a reload within the session. Never leaves the browser.
const deliveryKey = (sessionId: number, questionId: number) => `lens.delivery.${sessionId}.${questionId}`

export function saveDelivery(sessionId: number, questionId: number, metrics: DeliveryMetrics): void {
  try {
    localStorage.setItem(deliveryKey(sessionId, questionId), JSON.stringify(metrics))
  } catch {
    /* storage unavailable — the panel just won't persist across reloads */
  }
}

export function readDelivery(sessionId: number, questionId: number): DeliveryMetrics | null {
  try {
    const raw = localStorage.getItem(deliveryKey(sessionId, questionId))
    return raw ? (JSON.parse(raw) as DeliveryMetrics) : null
  } catch {
    return null
  }
}
