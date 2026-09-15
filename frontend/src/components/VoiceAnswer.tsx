import { useEffect, useRef } from 'react'
import { Square } from 'lucide-react'
import { Button } from '@/components/ui/Button'

// The "Listening" state (design 4a): a live waveform driven by the mic input level, plus the running
// transcript as it's recognized. Purely presentational — recognition itself lives in the parent's
// useSpeechRecognition hook. The waveform uses a short-lived getUserMedia + AnalyserNode; if mic
// metering is unavailable it degrades to a calm animated placeholder so the state still reads "live".
export function VoiceAnswer({ transcript, onStop }: { transcript: string; onStop: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const BARS = 24
    let raf = 0
    let stream: MediaStream | null = null
    let audioCtx: AudioContext | null = null
    let cancelled = false

    const draw = (levels: number[]) => {
      const { width, height } = canvas
      ctx.clearRect(0, 0, width, height)
      ctx.fillStyle = 'oklch(0.5 0.04 250)'
      const bw = width / levels.length
      for (let i = 0; i < levels.length; i++) {
        const h = Math.max(2, levels[i] * height)
        ctx.fillRect(i * bw + bw * 0.2, (height - h) / 2, bw * 0.6, h)
      }
    }

    const runPlaceholder = () => {
      let t = 0
      const loop = () => {
        t += 0.08
        const levels = Array.from({ length: BARS }, (_, i) =>
          reduceMotion ? 0.22 : 0.2 + 0.18 * Math.abs(Math.sin(t + i * 0.5)),
        )
        draw(levels)
        raf = requestAnimationFrame(loop)
      }
      loop()
    }

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        audioCtx = new AudioContext()
        const source = audioCtx.createMediaStreamSource(stream)
        const analyser = audioCtx.createAnalyser()
        analyser.fftSize = 64
        source.connect(analyser)
        const data = new Uint8Array(analyser.frequencyBinCount)
        const loop = () => {
          analyser.getByteFrequencyData(data)
          const levels = Array.from(data.slice(0, BARS), (v) => v / 255)
          draw(levels)
          raf = requestAnimationFrame(loop)
        }
        loop()
      } catch {
        // Don't start (or leak) anything if we were torn down while getUserMedia was pending, and
        // release any partially-acquired resources before falling back to the animated placeholder.
        if (cancelled) return
        stream?.getTracks().forEach((track) => track.stop())
        audioCtx?.close().catch(() => {})
        runPlaceholder()
      }
    }
    start()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((track) => track.stop())
      audioCtx?.close().catch(() => {})
    }
  }, [])

  return (
    <div className="mt-6 bg-inset border border-line-strong rounded-xs px-5 py-5 animate-[fade-in_300ms_ease]">
      <div className="flex items-center justify-between gap-4">
        <span className="meta flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-[oklch(0.55_0.14_25)] animate-pulse" />
          Listening
        </span>
        <Button type="button" variant="outline" size="sm" onClick={onStop}>
          <Square size={13} strokeWidth={2} />
          Stop
        </Button>
      </div>

      <canvas ref={canvasRef} width={480} height={44} className="w-full h-11 mt-4" />

      <p className="font-serif text-[1.15rem] leading-[1.7] text-ink mt-4 min-h-[3rem] [text-wrap:pretty]">
        {transcript ? (
          <>
            {transcript}
            <span className="caret" />
          </>
        ) : (
          <span className="text-ink/45">Start speaking — your words appear here as you go.</span>
        )}
      </p>
    </div>
  )
}
