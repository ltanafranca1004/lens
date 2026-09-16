import { useCallback, useEffect, useState } from 'react'
import { Loader2, Play, Square } from 'lucide-react'
import {
  cancelSpeech,
  ensureKokoroLoaded,
  getTtsEngine,
  isTtsAvailable,
  setTtsEngine,
  speak,
  type TtsEngine,
  type TtsProgress,
} from '@/lib/tts'

// Two clearly-labeled controls beside the question:
//   - "Read aloud" / "Stop" — a labeled play/stop button (with a download % while the natural voice
//     loads), so it never reads as a mute icon.
//   - "Natural voice" — a labeled on/off toggle for the higher-quality on-device voice (Kokoro). All
//     Kokoro work runs in a Web Worker (see tts.ts), so downloading/synthesizing never freezes the tab.
export function QuestionAudioButton({ text }: { text: string }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'playing'>('idle')
  const [engine, setEngine] = useState<TtsEngine>(() => getTtsEngine())
  const [pct, setPct] = useState<number | null>(null) // model download progress (0-100)

  // Stop any in-flight playback when the question changes or the control unmounts.
  useEffect(() => {
    return () => cancelSpeech()
  }, [text])

  const onProgress = useCallback((p: TtsProgress) => {
    if (typeof p.progress === 'number') setPct(Math.round(p.progress))
  }, [])

  // Returning opted-in users: if Natural voice was enabled in a prior session, start the one-time
  // download on mount so it's ready (or partway) before "Read aloud". Opt-in only — never fires for
  // default/browser-voice users. ensureKokoroLoaded is idempotent + deduped, so remounting per
  // question is harmless; we don't pre-set pct here, so an already-loaded model shows no indicator.
  useEffect(() => {
    // Opt-in only, and only when the control is actually usable (isTtsAvailable) — otherwise the
    // component renders null and we'd start the ~110 MB load behind a control the user can't see.
    if (getTtsEngine() !== 'kokoro' || !isTtsAvailable()) return
    ensureKokoroLoaded(onProgress)
      .then(() => setPct(null))
      .catch(() => setPct(null))
  }, [onProgress])

  if (!isTtsAvailable()) return null

  const play = () => {
    console.log('[QuestionAudioButton] click, status=', status)
    if (status !== 'idle') {
      cancelSpeech()
      setStatus('idle')
      setPct(null)
      return
    }
    setStatus('loading')
    speak(
      text,
      {
        onStart: () => {
          setStatus('playing')
          setPct(null)
        },
        onEnd: () => {
          setStatus('idle')
          setPct(null)
        },
      },
      { onProgress },
    )
      .catch(() => {
        setStatus('idle')
        setPct(null)
      })
      // speak() may have fallen back Kokoro→browser; re-sync the toggle's displayed engine.
      .finally(() => setEngine(getTtsEngine()))
  }

  const toggleNatural = () => {
    const next: TtsEngine = engine === 'kokoro' ? 'browser' : 'kokoro'
    setTtsEngine(next)
    setEngine(next)
    if (next === 'kokoro') {
      // Opt-in prefetch: start the one-time download now (with progress) so it overlaps reading.
      setPct(0)
      ensureKokoroLoaded(onProgress)
        .then(() => setPct(null))
        .catch(() => setPct(null))
    } else {
      setPct(null)
    }
  }

  const label =
    status === 'loading'
      ? engine === 'kokoro' && pct !== null
        ? `Preparing ${pct}%`
        : 'Preparing…'
      : status === 'playing'
        ? 'Stop'
        : 'Read aloud'
  const Icon = status === 'loading' ? Loader2 : status === 'playing' ? Square : Play

  // Show download progress next to the toggle while prefetching (i.e. not mid-play).
  const downloading = engine === 'kokoro' && status !== 'loading' && pct !== null

  return (
    <div className="flex items-center gap-4 shrink-0">
      <button
        type="button"
        onClick={play}
        aria-label={status !== 'idle' ? 'Stop reading the question' : 'Read the question aloud'}
        className="inline-flex items-center gap-1.5 rounded-xs border border-line px-3 py-1.5 text-[13px] text-ink/75 hover:text-ink hover:bg-panel cursor-pointer"
      >
        <Icon size={14} strokeWidth={1.9} className={status === 'loading' ? 'animate-spin' : ''} />
        {label}
      </button>

      <button
        type="button"
        onClick={toggleNatural}
        aria-pressed={engine === 'kokoro'}
        title="Natural voice: higher quality, runs on your device. First use downloads ~100 MB once, then works offline."
        className={`inline-flex items-center gap-1.5 text-[12px] cursor-pointer ${
          engine === 'kokoro' ? 'text-link' : 'text-ink/45 hover:text-ink/70'
        }`}
      >
        <span
          aria-hidden
          className={`inline-block h-3 w-3 rounded-full border ${
            engine === 'kokoro' ? 'bg-link border-link' : 'border-ink/40'
          }`}
        />
        Natural voice{downloading ? ` · downloading ${pct}%` : ''}
      </button>
    </div>
  )
}
