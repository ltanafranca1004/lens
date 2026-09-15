import { useEffect, useState } from 'react'
import { Loader2, Volume2, VolumeX } from 'lucide-react'
import { cancelSpeech, getTtsEngine, isTtsAvailable, setTtsEngine, speak, type TtsEngine } from '@/lib/tts'

// The "read the question aloud" control beside the question. Plays via the browser's built-in speech
// synthesis by default (zero cost, works everywhere); the small "natural" toggle opts into the
// higher-quality on-device Kokoro voice (one-time ~110 MB download), which falls back transparently.
export function QuestionAudioButton({ text }: { text: string }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'playing'>('idle')
  const [engine, setEngine] = useState<TtsEngine>(() => getTtsEngine())

  // Stop any in-flight playback when the question changes or the control unmounts.
  useEffect(() => {
    return () => cancelSpeech()
  }, [text])

  if (!isTtsAvailable()) return null

  const toggle = () => {
    if (status !== 'idle') {
      cancelSpeech()
      setStatus('idle')
      return
    }
    setStatus('loading')
    speak(text, {
      onStart: () => setStatus('playing'),
      onEnd: () => setStatus('idle'),
    })
      .catch(() => setStatus('idle'))
      // speak() may have fallen back from Kokoro to the browser voice; re-sync the toggle so its
      // displayed engine matches the persisted preference (no need to toggle twice).
      .finally(() => setEngine(getTtsEngine()))
  }

  const flipEngine = () => {
    const next: TtsEngine = engine === 'kokoro' ? 'browser' : 'kokoro'
    setTtsEngine(next)
    setEngine(next)
  }

  const Icon = status === 'loading' ? Loader2 : status === 'playing' ? VolumeX : Volume2

  return (
    <div className="flex flex-col items-center gap-1 shrink-0">
      <button
        type="button"
        onClick={toggle}
        aria-label={status !== 'idle' ? 'Stop reading the question' : 'Read the question aloud'}
        title={
          status === 'loading' && engine === 'kokoro'
            ? 'Preparing the natural voice (one-time download)…'
            : 'Read the question aloud'
        }
        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-ink/50 hover:text-ink hover:bg-panel cursor-pointer"
      >
        <Icon size={17} strokeWidth={1.75} className={status === 'loading' ? 'animate-spin' : ''} />
      </button>
      <button
        type="button"
        onClick={flipEngine}
        aria-pressed={engine === 'kokoro'}
        title="Higher-quality on-device voice. First use downloads ~110 MB once, then works offline."
        className={`text-[10.5px] leading-none cursor-pointer ${
          engine === 'kokoro' ? 'text-link' : 'text-ink/40 hover:text-ink/70'
        }`}
      >
        natural
      </button>
    </div>
  )
}
