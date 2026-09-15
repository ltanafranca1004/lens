// Text-to-speech for reading questions aloud. Two engines, both zero ongoing cost and fully
// client-side:
//   - browser `speechSynthesis` (default): instant, no download, works in every browser.
//   - Kokoro-82M "natural voice" (opt-in): higher quality, runs entirely in a dedicated Web Worker
//     (see tts.worker.ts) so the ~110 MB one-time download + WASM inference never block/freeze the UI.
//     Model weights are cached (Cache API/IndexedDB); the ORT runtime wasm is fetched from jsDelivr on
//     first use. Falls back to speechSynthesis on any failure.
// No backend and no API key. The only network use is Kokoro's one-time weight + runtime download.

export type SpeakHandlers = { onStart?: () => void; onEnd?: () => void }
export type TtsEngine = 'browser' | 'kokoro'
export type TtsProgress = { file?: string; loaded?: number; total?: number; progress?: number }
export type SpeakOptions = { onProgress?: (p: TtsProgress) => void }

const ENGINE_KEY = 'lens.tts.engine'

export function isTtsAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function getTtsEngine(): TtsEngine {
  try {
    return localStorage.getItem(ENGINE_KEY) === 'kokoro' ? 'kokoro' : 'browser'
  } catch {
    return 'browser'
  }
}

export function setTtsEngine(engine: TtsEngine): void {
  try {
    localStorage.setItem(ENGINE_KEY, engine)
  } catch {
    /* ignore — preference just won't persist */
  }
}

// --- current playback + cancellation state ---
let currentAudio: HTMLAudioElement | null = null
let currentUrl: string | null = null
// Bumped on every cancel; speak() captures it and discards any worker result that arrives after a
// stop / newer request (the worker still finishes, but its audio is never played).
let activeRequest = 0

export function cancelSpeech(): void {
  activeRequest += 1
  try {
    window.speechSynthesis?.cancel()
  } catch {
    /* ignore */
  }
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.src = ''
    currentAudio = null
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl)
    currentUrl = null
  }
}

function speakBrowser(text: string, handlers: SpeakHandlers): Promise<void> {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis
    if (!synth) {
      resolve()
      return
    }
    synth.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 1
    utterance.onstart = () => handlers.onStart?.()
    utterance.onend = () => {
      handlers.onEnd?.()
      resolve()
    }
    utterance.onerror = () => {
      handlers.onEnd?.()
      resolve()
    }
    synth.speak(utterance)
  })
}

// --- Kokoro Web Worker client ---
export type SynthResult = { wav: ArrayBuffer; peak: number; sampleRate: number }

type WorkerOut =
  | { status: 'progress'; file?: string; loaded?: number; total?: number; progress?: number }
  | { status: 'ready' }
  | { status: 'complete'; id: number; wav: ArrayBuffer; peak: number; sampleRate: number }
  | { status: 'error'; id?: number; message: string }

let worker: Worker | null = null
let loadState: 'idle' | 'loading' | 'ready' = 'idle'
let loadWaiters: { resolve: () => void; reject: (e: Error) => void }[] = []
const loadProgressCbs = new Set<(p: TtsProgress) => void>()
const generateWaiters = new Map<number, { resolve: (r: SynthResult) => void; reject: (e: Error) => void }>()
let nextGenerateId = 1

function getWorker(): Worker {
  if (!worker) {
    console.log('[tts] creating Kokoro worker')
    // URL literal must be inline for Vite's worker bundling; { type: 'module' } for ESM imports.
    worker = new Worker(new URL('./tts.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data
      if (m.status === 'progress') {
        loadProgressCbs.forEach((cb) => cb(m))
      } else if (m.status === 'ready') {
        console.log('[tts] worker ready')
        loadState = 'ready'
        loadWaiters.forEach((w) => w.resolve())
        loadWaiters = []
      } else if (m.status === 'complete') {
        const waiter = generateWaiters.get(m.id)
        if (waiter) {
          generateWaiters.delete(m.id)
          waiter.resolve({ wav: m.wav, peak: m.peak, sampleRate: m.sampleRate })
        }
      } else if (m.status === 'error') {
        const err = new Error(m.message)
        if (typeof m.id === 'number') {
          const waiter = generateWaiters.get(m.id)
          if (waiter) {
            generateWaiters.delete(m.id)
            waiter.reject(err)
          }
        } else {
          loadState = 'idle'
          loadWaiters.forEach((w) => w.reject(err))
          loadWaiters = []
        }
      }
    }
    worker.onerror = (e) => {
      const err = new Error(`TTS worker error: ${e.message || 'unknown'}`)
      console.error('[tts]', err.message)
      // Discard the dead worker so the next ensureKokoroLoaded() spawns a fresh one — otherwise a
      // later call would post to a worker that can't respond and its waiter would hang forever.
      const failedWorker = worker
      worker = null
      failedWorker?.terminate()
      loadState = 'idle'
      loadWaiters.forEach((w) => w.reject(err))
      loadWaiters = []
      generateWaiters.forEach((w) => w.reject(err))
      generateWaiters.clear()
    }
  }
  return worker
}

// Kick off (or await) the one-time model load. Safe to call repeatedly — the worker caches the model.
export function ensureKokoroLoaded(onProgress?: (p: TtsProgress) => void): Promise<void> {
  const w = getWorker()
  if (loadState === 'ready') return Promise.resolve()
  if (onProgress) loadProgressCbs.add(onProgress)
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      if (onProgress) loadProgressCbs.delete(onProgress)
    }
    loadWaiters.push({
      resolve: () => {
        cleanup()
        resolve()
      },
      reject: (e) => {
        cleanup()
        reject(e)
      },
    })
    if (loadState === 'idle') {
      loadState = 'loading'
      console.log('[tts] posting load')
      w.postMessage({ type: 'load' })
    }
  })
}

// Synthesize `text` in the worker; resolves with the WAV bytes + peak amplitude. Testable seam.
export function synthesizeKokoro(text: string, opts: SpeakOptions = {}): Promise<SynthResult> {
  const w = getWorker()
  const id = nextGenerateId++
  return ensureKokoroLoaded(opts.onProgress).then(
    () =>
      new Promise<SynthResult>((resolve, reject) => {
        generateWaiters.set(id, { resolve, reject })
        console.log('[tts] posting generate', id)
        w.postMessage({ type: 'generate', id, text })
      }),
  )
}

function assertAudible(peak: number): void {
  if (!Number.isFinite(peak) || peak < 1e-4) {
    throw new Error(`Kokoro produced silent audio (peak=${peak}).`)
  }
}

function playWav(wav: ArrayBuffer, handlers: SpeakHandlers): Promise<void> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }))
    const audio = new Audio(url)
    currentAudio = audio
    currentUrl = url
    const finish = (err?: unknown) => {
      if (err) console.error('[tts] playback error', err)
      handlers.onEnd?.()
      if (currentUrl === url) {
        URL.revokeObjectURL(url)
        currentUrl = null
      }
      if (currentAudio === audio) currentAudio = null
      resolve()
    }
    audio.onplay = () => {
      console.log('[tts] playback start')
      handlers.onStart?.()
    }
    audio.onended = () => {
      console.log('[tts] playback end')
      finish()
    }
    audio.onerror = () => finish('audio element error')
    audio.play().catch((err) => finish(err))
  })
}

// Speak `text` with the preferred engine. Kokoro runs in the worker (never blocks the UI); on any
// failure or silent output, log, revert to the browser voice for the session, and speak with it now.
export async function speak(text: string, handlers: SpeakHandlers = {}, opts: SpeakOptions = {}): Promise<void> {
  cancelSpeech()
  const req = activeRequest
  const trimmed = text.trim()
  if (!trimmed) return
  console.log('[tts] speak', { engine: getTtsEngine(), chars: trimmed.length })

  if (getTtsEngine() === 'kokoro') {
    try {
      const { wav, peak } = await synthesizeKokoro(trimmed, opts)
      if (req !== activeRequest) {
        console.log('[tts] discarding stale Kokoro result')
        return
      }
      assertAudible(peak)
      await playWav(wav, handlers)
      return
    } catch (err) {
      if (req !== activeRequest) return // cancelled — don't fall back to a stale read
      console.error('[tts] Kokoro unavailable; falling back to the browser voice.', err)
      setTtsEngine('browser')
    }
  }

  if (req !== activeRequest) return
  await speakBrowser(trimmed, handlers)
}
