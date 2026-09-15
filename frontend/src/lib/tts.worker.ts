// Dedicated Web Worker that runs the ENTIRE Kokoro pipeline off the main thread: the ~90-110 MB
// model download, the espeak-ng phonemizer, tokenization, and ONNX (WASM) inference. transformers.js
// forces ONNX's WASM backend onto the calling thread (proxy=false), and kokoro-js runs the phonemizer
// + tokenizer synchronously too — so doing this on the main thread freezes the tab. Here it can't.
import { KokoroTTS, env } from 'kokoro-js'

// Self-host the ONNX Runtime Web wasm from our own origin instead of the jsDelivr CDN (transformers.js
// sets the CDN default at import time, so override it here, before any load). vite-plugin-static-copy
// serves ort-wasm-simd-threaded.jsep.{wasm,mjs} at /ort/ — both are required (once wasmPaths is set,
// ORT fetches the external .mjs glue too). Model weights still come from the Hugging Face CDN.
env.wasmPaths = '/ort/'

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'

// The WebWorker lib conflicts with the app's DOM lib (both declare `self`), so we type the worker
// scope structurally and cast through `unknown` — avoids pulling the WebWorker lib. Transferable and
// MessageEvent come from the DOM lib.
interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void
  addEventListener(type: 'message', listener: (ev: MessageEvent) => void): void
}
const ctx = self as unknown as WorkerScope

type ProgressInfo = {
  status?: string
  file?: string
  name?: string
  loaded?: number
  total?: number
  progress?: number
}

type InMsg = { type: 'load' } | { type: 'generate'; id: number; text: string }

let ttsPromise: ReturnType<typeof KokoroTTS.from_pretrained> | null = null

function load(): ReturnType<typeof KokoroTTS.from_pretrained> {
  if (!ttsPromise) {
    console.log('[tts.worker] loading model', MODEL_ID)
    ttsPromise = KokoroTTS.from_pretrained(MODEL_ID, {
      // WASM + q8: correct on every browser. (WebGPU + q8 returns silent audio — see tts.ts history.)
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (p: ProgressInfo) => {
        if (p.status === 'progress') {
          ctx.postMessage({
            status: 'progress',
            file: p.file,
            loaded: p.loaded,
            total: p.total,
            progress: p.progress,
          })
        }
      },
    }).catch((err) => {
      ttsPromise = null // allow a retry on a later attempt
      throw err
    })
  }
  return ttsPromise
}

ctx.addEventListener('message', async (ev: MessageEvent) => {
  const msg = ev.data as InMsg
  try {
    if (msg.type === 'load') {
      await load()
      console.log('[tts.worker] ready')
      ctx.postMessage({ status: 'ready' })
      return
    }
    if (msg.type === 'generate') {
      const tts = await load()
      console.log('[tts.worker] generate start', msg.id)
      const audio = await tts.generate(msg.text, { voice: 'af_heart' })
      const samples = audio.audio
      let peak = 0
      for (let i = 0; i < samples.length; i++) {
        const v = Math.abs(samples[i])
        if (v > peak) peak = v
      }
      const wav = audio.toWav() // ArrayBuffer (transferable). Do NOT use audio.save() — throws in a worker.
      console.log('[tts.worker] generate done', msg.id, 'samples', samples.length, 'peak', peak.toFixed(4))
      ctx.postMessage({ status: 'complete', id: msg.id, wav, peak, sampleRate: audio.sampling_rate }, [wav])
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[tts.worker] error', message)
    ctx.postMessage({ status: 'error', id: msg.type === 'generate' ? msg.id : undefined, message })
  }
})
