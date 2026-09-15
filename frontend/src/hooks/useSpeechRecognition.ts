import { useCallback, useEffect, useRef, useState } from 'react'
import { TranscriptBuilder } from '@/lib/segmentation'

// The browser's built-in speech-to-text. Free and client-side (no key, quota, or bill), but
// Chrome-first: Chrome/Edge + Safari 14.5+ expose it under the webkit prefix; Firefox does not.
// `isSupported` (constructor present) decides whether to show the voice toggle; a runtime `error`
// (Brave/Electron/offline expose the API but fail at start) is the second line of defence — callers
// fall back to typing when either says voice is unavailable.
const SpeechRecognitionImpl: SpeechRecognitionConstructor | undefined =
  typeof window !== 'undefined' ? (window.SpeechRecognition ?? window.webkitSpeechRecognition) : undefined

// Silence (ms) after the last recognized activity before the in-progress sentence is committed. The
// engine already finalizes on short phrase-pauses; this extra wait distinguishes a brief mid-sentence
// hesitation (speech resumes quickly → same sentence) from a real sentence boundary (longer silence).
const PAUSE_MS = 1000

export type SpeechRecognitionState = {
  isSupported: boolean
  listening: boolean
  transcript: string
  // A user-facing message when voice can't be used (permission denied, no mic, or a browser that
  // exposes the API but fails at runtime). When set, callers should fall back to typing.
  error: string | null
  elapsedMs: number
  start: () => void
  stop: () => void
}

export function useSpeechRecognition(lang = 'en-US'): SpeechRecognitionState {
  const isSupported = !!SpeechRecognitionImpl
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)

  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const builderRef = useRef<TranscriptBuilder | null>(null)
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wantListeningRef = useRef(false) // user intent — drives auto-restart after a silence timeout
  const firstSpeechAtRef = useRef<number | null>(null)

  const clearPauseTimer = useCallback(() => {
    if (pauseTimerRef.current) {
      clearTimeout(pauseTimerRef.current)
      pauseTimerRef.current = null
    }
  }, [])

  const stop = useCallback(() => {
    wantListeningRef.current = false
    if (firstSpeechAtRef.current !== null) setElapsedMs(Date.now() - firstSpeechAtRef.current)
    try {
      recognitionRef.current?.stop()
    } catch {
      /* already stopped */
    }
    // The final result and sentence flush happen in onend, after the in-progress utterance lands.
  }, [])

  const start = useCallback(() => {
    if (!SpeechRecognitionImpl) return
    // Each recording session starts fresh; the caller appends the result to any existing text.
    builderRef.current = new TranscriptBuilder()
    firstSpeechAtRef.current = null
    clearPauseTimer()
    setTranscript('')
    setElapsedMs(0)
    setError(null)
    wantListeningRef.current = true

    const recognition = new SpeechRecognitionImpl()
    recognition.lang = lang
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onresult = (event) => {
      if (firstSpeechAtRef.current === null) firstSpeechAtRef.current = Date.now()
      const builder = builderRef.current
      if (!builder) return
      let interimText = ''
      // Iterate from resultIndex so each result is counted once (avoids the duplicate/growing bug):
      // finals are buffered into the current sentence, interim is the still-open tail.
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const text = result[0]?.transcript ?? ''
        if (result.isFinal) builder.addFinal(text)
        else interimText += text
      }
      builder.setInterim(interimText)
      setTranscript(builder.text)
      // Reset the pause timer on any activity; a genuine silence gap after a final commits a sentence.
      clearPauseTimer()
      if (builder.hasPendingSentence()) {
        pauseTimerRef.current = setTimeout(() => {
          builder.pause()
          setTranscript(builder.text)
        }, PAUSE_MS)
      }
    }

    recognition.onerror = (event) => {
      // Silence timeouts and our own stop()/restart are benign — onend handles continuation.
      if (event.error === 'no-speech' || event.error === 'aborted') return
      wantListeningRef.current = false
      clearPauseTimer()
      setListening(false)
      setError(
        event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? 'Microphone access was blocked. Enable it, or just type your answer.'
          : event.error === 'audio-capture'
            ? 'No microphone was found. Type your answer instead.'
            : event.error === 'network'
              ? "Voice input isn't available in this browser. Type your answer instead."
              : 'Voice input stopped unexpectedly. Type your answer instead.',
      )
    }

    recognition.onend = () => {
      // Chrome auto-stops after a few seconds of silence; restart while the user still intends to
      // dictate. Once they press Stop (or an error fires), wantListening is false and we settle.
      if (wantListeningRef.current) {
        try {
          recognition.start()
          return
        } catch {
          /* fall through to settle */
        }
      }
      clearPauseTimer()
      builderRef.current?.finish()
      setTranscript(builderRef.current?.text ?? '')
      setListening(false)
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
      setListening(true)
    } catch {
      // start() throws if called while already running — treat as already listening.
      setListening(true)
    }
  }, [lang, clearPauseTimer])

  // Tear down on unmount (e.g. moving to another question).
  useEffect(() => {
    return () => {
      wantListeningRef.current = false
      clearPauseTimer()
      try {
        recognitionRef.current?.abort()
      } catch {
        /* ignore */
      }
    }
  }, [clearPauseTimer])

  return { isSupported, listening, transcript, error, elapsedMs, start, stop }
}
