import { useEffect, useState } from 'react'

// Returns true once `active` has stayed true for `delayMs`, and resets when `active` goes false —
// so a "warming up" hint appears only while a request is genuinely slow (e.g. a Render free-tier
// cold start, ~30-60s) and never flashes on a fast one. The reset lives in the effect cleanup, and
// the return is gated on `active`, so a new active period always starts fresh.
export function useSlowNotice(active: boolean, delayMs = 6000): boolean {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!active) return
    const timer = setTimeout(() => setSlow(true), delayMs)
    return () => {
      clearTimeout(timer)
      setSlow(false)
    }
  }, [active, delayMs])
  return active && slow
}
