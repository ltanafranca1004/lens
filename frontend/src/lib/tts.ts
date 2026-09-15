// Text-to-speech for reading questions aloud. Two engines, both zero ongoing cost and fully
// client-side:
//   - browser `speechSynthesis` (default): instant, no download, works in every browser.
//   - Kokoro-82M via kokoro-js (opt-in "natural voice"): higher quality, runs in the browser via
//     WASM (ONNX Runtime Web). The ~110 MB model weights download once and are cached
//     (Cache API/IndexedDB); the ORT runtime wasm is fetched from the jsDelivr CDN on first use.
//     Falls back to speechSynthesis on any failure.
// No backend and no API key. The only network use is Kokoro's one-time weight + runtime download.

export type SpeakHandlers = { onStart?: () => void; onEnd?: () => void }
export type TtsEngine = 'browser' | 'kokoro'

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

// --- current playback handles, so cancelSpeech() can interrupt either engine ---
let currentAudio: HTMLAudioElement | null = null
let currentUrl: string | null = null
// Bumped on every cancel; a pending async Kokoro generation checks it and bails so a stop (or a new
// request) during the seconds-long load can't play stale audio afterwards.
let speechGeneration = 0

export function cancelSpeech(): void {
  speechGeneration += 1
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

// Kokoro is loaded lazily and cached for the tab's lifetime; transformers.js caches the weights in
// the browser (Cache API / IndexedDB), so the ~110 MB download is one-time per device.
type KokoroInstance = InstanceType<(typeof import('kokoro-js'))['KokoroTTS']>
let kokoroPromise: Promise<KokoroInstance> | null = null

function loadKokoro(): Promise<KokoroInstance> {
  if (!kokoroPromise) {
    kokoroPromise = (async () => {
      const { KokoroTTS } = await import('kokoro-js')
      // WASM + q8 on every browser: reliable and ~90-110 MB (cached after first load). We deliberately
      // do NOT use WebGPU — dtype 'q8' on the ORT WebGPU/JSEP backend returns silent/NaN audio without
      // throwing (transformers.js #1512/#1320, onnxruntime #32578); a correct WebGPU path would need
      // dtype 'fp32' (~326 MB). WASM q8 trades a few seconds of CPU synth time for correctness.
      return KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
        dtype: 'q8',
        device: 'wasm',
      })
    })().catch((err) => {
      kokoroPromise = null // allow a retry on a later attempt
      throw err
    })
  }
  return kokoroPromise
}

function playBlob(blob: Blob, handlers: SpeakHandlers): Promise<void> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    currentAudio = audio
    currentUrl = url
    // Playback errors are logged but non-fatal: we always resolve so a user Stop (cancelSpeech clears
    // the src) or a benign decode hiccup never triggers a second, doubled read via the browser voice.
    const finish = (err?: unknown) => {
      if (err) console.error('[tts] Kokoro audio playback error.', err)
      handlers.onEnd?.()
      if (currentUrl === url) {
        URL.revokeObjectURL(url)
        currentUrl = null
      }
      if (currentAudio === audio) currentAudio = null
      resolve()
    }
    audio.onplay = () => handlers.onStart?.()
    audio.onended = () => finish()
    audio.onerror = () => finish('audio element error')
    audio.play().catch((err) => finish(err))
  })
}

// Guard against a valid-WAV-but-silent waveform (the class of bug a wrong dtype/device combo produced:
// NaN/zero samples wrapped in a correct header). Throwing here lets speak()'s fallback engage and
// speak with the browser voice instead of "playing" silence with no error.
function assertAudible(samples: Float32Array): void {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i])
    if (v > peak) peak = v
  }
  if (!samples.length || !Number.isFinite(peak) || peak < 1e-4) {
    throw new Error(`Kokoro produced silent audio (samples=${samples.length}, peak=${peak}).`)
  }
}

// Speak `text` with the preferred engine. When "natural voice" is selected but Kokoro can't run or
// returns unusable audio (load/download failure, decode error, silent output), log it, revert the
// preference to the browser voice for the rest of the session, and speak with it now — so the user
// always hears something.
export async function speak(text: string, handlers: SpeakHandlers = {}): Promise<void> {
  cancelSpeech()
  const generation = speechGeneration
  const trimmed = text.trim()
  if (!trimmed) return

  if (getTtsEngine() === 'kokoro') {
    try {
      const tts = await loadKokoro()
      if (generation !== speechGeneration) return // cancelled during load
      const result = await tts.generate(trimmed, { voice: 'af_heart' })
      if (generation !== speechGeneration) return // cancelled during generation
      assertAudible(result.audio)
      await playBlob(result.toBlob(), handlers)
      return
    } catch (err) {
      if (generation !== speechGeneration) return // cancelled — don't fall back to a stale read
      console.error('[tts] Kokoro unavailable; falling back to the browser voice.', err)
      setTtsEngine('browser')
    }
  }
  await speakBrowser(trimmed, handlers)
}
