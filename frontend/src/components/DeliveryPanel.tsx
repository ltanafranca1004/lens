import type { DeliveryMetrics } from '@/lib/delivery'

// The delivery panel (design 4c): speaking pace + filler-word count, reported OUTSIDE the four rubric
// dimensions. Noted, never scored — the score judges what was said, not how. Set apart visually from
// the dimension cards so the distinction is unmistakable.
export function DeliveryPanel({ metrics }: { metrics: DeliveryMetrics }) {
  return (
    <div className="mt-6 bg-panel border border-line rounded-xs px-5 py-4">
      <p className="meta">Delivery · noted, not scored</p>

      <div className="flex flex-wrap gap-x-10 gap-y-2 mt-3">
        <span className="flex items-baseline gap-2">
          <span className="font-serif text-xl">{metrics.wordsPerMinute ?? '—'}</span>
          <span className="text-[13px] text-ink-soft">words / min</span>
        </span>
        <span className="flex items-baseline gap-2">
          <span className="font-serif text-xl">{metrics.fillerCount}</span>
          <span className="text-[13px] text-ink-soft">
            filler {metrics.fillerCount === 1 ? 'word' : 'words'}
          </span>
        </span>
      </div>

      <p className="text-[12.5px] leading-snug mt-3 text-ink/50 max-w-[52ch]">
        Pace and filler words are here for your awareness only. They don&rsquo;t affect your score —
        completeness, substance, reasoning and correctness judge what you said, not how.
      </p>
    </div>
  )
}
