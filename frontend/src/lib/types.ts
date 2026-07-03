export type User = {
  id: number
  email: string
  display_name: string
  created_at: string
}

export type Token = {
  access_token: string
  token_type: string
}

export type SessionStatus = 'in_progress' | 'completed'

export type SessionSummary = {
  id: number
  job_posting: string
  status: SessionStatus
  created_at: string
  completed_at: string | null
}

export type Question = {
  id: number
  question_text: string
  user_answer: string | null
  ai_feedback: string | null
  score: number | null
  skipped: boolean
  order_index: number
  answered_at: string | null
}

export type SessionDetail = SessionSummary & {
  questions: Question[]
  average_score: number | null
}
