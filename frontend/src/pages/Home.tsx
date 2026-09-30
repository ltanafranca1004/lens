import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Field'
import { roleLabel } from '@/lib/rubric'
import { useSlowNotice } from '@/lib/useSlowNotice'
import type { Question, SessionSummary } from '@/lib/types'

// Kept in sync with the backend guards in app/resume.py (extensions + MAX_UPLOAD_BYTES).
const RESUME_EXTENSIONS = ['.pdf', '.docx']
const MAX_RESUME_BYTES = 5 * 1024 * 1024

// A failed resume upload, so its message can be shown next to the resume field.
class ResumeUploadError extends Error {}

// The session from an attempt that failed after it was created. Retrying with the same posting
// reuses it instead of creating another session with no questions.
type PendingSession = { sessionId: number; posting: string; uploaded: File | null }

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}

export function HomePage() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const [posting, setPosting] = useState('')
  const [resumeFile, setResumeFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resumeError, setResumeError] = useState<string | null>(null)
  const pending = useRef<PendingSession | null>(null)

  const sessionsQuery = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api<SessionSummary[]>('/sessions'),
  })
  const recent = sessionsQuery.data?.slice(0, 4) ?? []

  const startMutation = useMutation({
    mutationFn: async ({ jobPosting, resume }: { jobPosting: string; resume: File | null }) => {
      let p = pending.current
      // A new posting, or a resume removed after it was uploaded (the session still holds its
      // text), needs a fresh session.
      if (!p || p.posting !== jobPosting || (p.uploaded && !resume)) {
        const session = await api<SessionSummary>('/sessions', {
          method: 'POST',
          body: { job_posting: jobPosting },
        })
        p = pending.current = { sessionId: session.id, posting: jobPosting, uploaded: null }
      }
      // Upload the resume (if any) BEFORE generating — the backend snapshots resume_text at
      // generation time and 409s a resume uploaded after questions exist. A different file replaces
      // the one uploaded on an earlier attempt.
      if (resume && resume !== p.uploaded) {
        const form = new FormData()
        form.append('file', resume)
        try {
          await api<{ filename: string; resume_chars: number }>(`/sessions/${p.sessionId}/resume`, {
            method: 'POST',
            body: form,
          })
        } catch (err) {
          throw new ResumeUploadError(err instanceof ApiError ? err.message : 'Could not upload the resume.')
        }
        p.uploaded = resume
      }
      try {
        await api<Question[]>(`/sessions/${p.sessionId}/questions`, { method: 'POST' })
      } catch (err) {
        // 409: an earlier attempt generated the questions but its response never arrived.
        if (!(err instanceof ApiError && err.status === 409)) throw err
      }
      pending.current = null
      return p.sessionId
    },
    onSuccess: (sessionId) => {
      qc.invalidateQueries({ queryKey: ['sessions'] })
      nav(`/interview/${sessionId}`)
    },
    onError: (err) => {
      if (err instanceof ResumeUploadError) setResumeError(err.message)
      else setError(err instanceof ApiError ? err.message : 'Something went wrong')
    },
  })

  const slow = useSlowNotice(startMutation.isPending)

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setResumeError(null)
    if (posting.trim().length < 20) {
      setError('Paste a real job posting — at least 20 characters.')
      return
    }
    if (resumeFile) {
      const lower = resumeFile.name.toLowerCase()
      if (!RESUME_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
        setResumeError('Resume must be a PDF or .docx file.')
        return
      }
      if (resumeFile.size > MAX_RESUME_BYTES) {
        setResumeError('Resume file is too large (max 5 MB).')
        return
      }
    }
    startMutation.mutate({ jobPosting: posting, resume: resumeFile })
  }

  return (
    <div>
      <h1 className="font-serif font-normal text-[2.6rem] sm:text-[2.9rem] leading-[1.08] max-w-[18ch]">
        What are you interviewing for?
      </h1>
      <p className="text-[15.5px] leading-[1.62] text-ink-soft max-w-[58ch] mt-3 [text-wrap:pretty]">
        Paste the posting and Lens writes five questions shaped to that role. You type your answers,
        one at a time, and get the reasoning behind every score.
      </p>

      <form onSubmit={onSubmit} className="mt-8">
        <Textarea
          label="The posting"
          hint="Longer postings make sharper questions."
          rows={12}
          placeholder={
            'Backend Engineer (Co-op), Acme Inc.\n\nYou will work on Python services using FastAPI and PostgreSQL…'
          }
          value={posting}
          onChange={(e) => setPosting(e.target.value)}
          error={error ?? undefined}
        />
        <div className="mt-4">
          <label htmlFor="resume" className="meta block mb-1.5">
            Resume{' '}
            <span className="text-ink-soft">
              (optional — personalizes two of the five questions)
            </span>
          </label>
          <input
            id="resume"
            type="file"
            accept=".pdf,.docx"
            onChange={(e) => {
              setResumeFile(e.target.files?.[0] ?? null)
              setResumeError(null)
            }}
            aria-invalid={resumeError ? true : undefined}
            className="block w-full text-[14px] text-ink-soft file:mr-3 file:rounded-md file:border file:border-line file:bg-panel file:px-3 file:py-1.5 file:text-ink hover:file:bg-panel/70 file:cursor-pointer"
          />
          {resumeFile && <p className="meta mt-1.5">Attached: {resumeFile.name}</p>}
          {resumeError && (
            <p className="mt-1.5 text-[0.8rem] text-[oklch(0.5_0.14_25)] leading-snug" role="alert">
              {resumeError}
            </p>
          )}
        </div>
        <div className="flex items-center justify-between gap-4 mt-5">
          <span className="meta hidden sm:inline">
            Five questions · no timer · leave any one unanswered
          </span>
          <Button type="submit" size="lg" loading={startMutation.isPending}>
            Begin session
            <ArrowRight size={16} strokeWidth={1.75} />
          </Button>
        </div>
        {slow && (
          <p className="mt-4 text-sm text-ink-soft" role="status">
            Warming up — the first request can take up to a minute on the free tier.
          </p>
        )}
      </form>

      {recent.length > 0 && (
        <section className="mt-11">
          <p className="meta">Earlier sessions</p>
          <ul className="mt-2">
            {recent.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() =>
                    nav(s.status === 'completed' ? `/sessions/${s.id}` : `/interview/${s.id}`)
                  }
                  className="w-full text-left grid grid-cols-[1fr_auto] gap-x-5 gap-y-1 items-baseline py-3.5 pl-4 border-l-2 border-line cursor-pointer hover:border-link hover:bg-panel/50 transition-colors"
                >
                  <span className="text-[14.5px] text-ink line-clamp-1">
                    {roleLabel(s.job_posting, s.id)}
                  </span>
                  <span className="meta whitespace-nowrap">
                    {s.status === 'completed' ? 'Filed' : 'Open'}
                  </span>
                  <span className="meta col-span-2">{formatDate(s.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
