# CLAUDE.md — Technical Interview Prep App

This file gives Claude full context on the project so every conversation starts with shared understanding. Read this before helping with any code.

---

## What This App Does

A web app that prepares job seekers for technical interviews by generating role-specific questions from a real job posting, evaluating their answers with AI feedback, and saving session history.

**One sentence:** Paste a job posting, get tailored interview questions, answer them, get AI feedback, track your progress.

**Target users:** Students and job seekers preparing for co-op and internship interviews.

---

## User Flow (memorize this)

1. User lands on homepage
2. User signs up or logs in
3. User pastes a job posting into a text field
4. App generates role-specific technical questions (stored in DB upfront)
5. User is shown one question at a time
6. User types an answer and submits
7. AI evaluates the answer → returns score (1–5) + structured feedback
8. App saves answer, score, and feedback to the database
9. User can skip or move to the next question
10. Session ends → user sees a summary of their performance
11. Session is saved and viewable in history

---

## Tech Stack

| Layer            | Choice                                          | Why                                                            |
| ---------------- | ----------------------------------------------- | -------------------------------------------------------------- |
| Backend          | FastAPI                                         | Modern, async, built for APIs, future iOS compatibility        |
| Database         | PostgreSQL                                      | Multi-user, production-grade, relational                       |
| Auth             | JWT + PyJWT + FastAPI Security                  | Stateless, works identically for React and iOS                 |
| Password hashing | bcrypt                                          | Intentionally slow, salted, brute-force resistant              |
| AI               | Groq API (llama-3.3-70b-versatile)              | Generates questions and evaluates answers (free tier)          |
| Frontend         | React                                           | Portfolio value, co-op resume signal, needed for iOS API layer |
| Deployment       | Railway                                         | Simple setup, auto-detects FastAPI, free tier                  |

---

## Database Schema

### users

```
id            INTEGER PRIMARY KEY
email         TEXT UNIQUE NOT NULL
display_name  TEXT NOT NULL
password_hash TEXT NOT NULL
created_at    TIMESTAMP DEFAULT now()
```

### sessions

```
id            INTEGER PRIMARY KEY
user_id       INTEGER FK → users.id (CASCADE DELETE)
job_posting   TEXT NOT NULL
status        TEXT DEFAULT 'in_progress'
created_at    TIMESTAMP DEFAULT now()
completed_at  TIMESTAMP NULLABLE
```

### questions

```
id            INTEGER PRIMARY KEY
session_id    INTEGER FK → sessions.id (CASCADE DELETE)
question_text TEXT NOT NULL
user_answer   TEXT NULLABLE
ai_feedback   TEXT NULLABLE
score         INTEGER NULLABLE   -- 1–5, NULL if skipped or unanswered
skipped       BOOLEAN DEFAULT false
order_index   INTEGER NOT NULL
answered_at   TIMESTAMP NULLABLE
```

**Key decisions:**

- Score is calculated dynamically (AVG from questions table) — not stored on session
- Skipped questions have NULL for user_answer, ai_feedback, score — skipped boolean is source of truth
- Cascading deletes: delete user → sessions delete → questions delete
- user_answer and ai_feedback are nullable because questions are created before answered

---

## API Routes

```
POST   /auth/register                          — create new user (public)
POST   /auth/login                             — log in, return JWT (public)
GET    /auth/me                                — get current user info (protected)

POST   /sessions                               — create session from job posting (protected)
GET    /sessions                               — get all past sessions (protected)
GET    /sessions/{id}                          — get session + all questions (protected)
PATCH  /sessions/{id}                          — mark session completed (protected)

POST   /sessions/{id}/questions                — generate questions via Groq (protected)
POST   /sessions/{id}/questions/{qid}/answer   — submit answer, get AI feedback (protected)
POST   /sessions/{id}/questions/{qid}/skip     — skip a question (protected)
```

**Protected** = requires valid JWT via `Depends(get_current_user)`

---

## What Happens When a User Submits an Answer

1. Request arrives with answer in the body
2. JWT verified — is this a real logged-in user?
3. Input validated — is there actually an answer?
4. Original question fetched from PostgreSQL
5. Groq called with question + user's answer
6. Groq returns score (1–5) + structured feedback
7. Answer, score, and feedback saved to questions table in PostgreSQL
8. Response returned to frontend as JSON

Groq never touches the database. The backend handles everything before and after the Groq call.

---

## Groq API Usage

**Model:** `llama-3.3-70b-versatile`

**SDK:** `groq` (the official Groq Python SDK; OpenAI-compatible chat completions API via `client.chat.completions.create`).

**Question generation:** Send full job posting text + role title → receive a JSON object of the form `{"questions": [...]}` with exactly 5 question strings

**Answer evaluation:** Send question + user's answer → receive JSON with `score` (integer 1–5) and `feedback` (string)

**No conversation history needed:** Questions are generated once upfront and stored. Each evaluation is independent.

**Always enforce JSON output via `response_format={"type": "json_object"}`** and describe the exact JSON shape in the prompt. Vague prompts produce inconsistent responses; JSON mode guarantees parseable JSON. The backend then strictly validates the parsed shape (question count, score type/range) before trusting it.

**Error handling:** Catch `groq.APIError` — return clean HTTP errors, no retry logic in V1.

**Why Groq:** Free tier allows real LLM responses during development without spending, with fast inference. Same prompt-engineering principles apply; if a future migration to Claude (or any provider) is needed, the `app/llm.py` seam keeps callers unchanged.

---

## Environment Variables

```
DATABASE_URL=postgresql://user:password@localhost/dbname
GROQ_API_KEY=...
JWT_SECRET=long-random-string
USE_MOCK_LLM=true   # set to false to call the real Groq API
```

Never hardcode these. Always read from environment. Never commit `.env` to GitHub.

---

## Build Order (do not skip ahead)

1. FastAPI setup + virtual environment + dependencies installed
2. `.env` file created, PostgreSQL connected
3. Single test route returning `{"status": "ok"}` working locally
4. Database models defined (SQLAlchemy)
5. Alembic migrations set up
6. Auth routes: POST /auth/register and POST /auth/login working end to end
7. JWT middleware working — protected routes rejecting invalid tokens
8. Session routes
9. Question generation with Groq
10. Answer evaluation with Groq
11. React frontend (after backend is fully working)

**Rule:** Do not touch the next step until the current one works completely.

---

## V1 Feature Lock

Do not add anything to this list:

- User sign up and log in
- Paste job posting and generate questions
- Answer questions one at a time and receive AI feedback
- Skip or move through questions
- View past interview sessions

If a feature is not on this list, it does not exist in V1. No exceptions.

When opening pull requests for Lens, follow this exact workflow and format based on my established style.

## Branch naming
type/short-description
Examples: fix/answer-evaluation, feat/supabase-auth, chore/cleanup-deps

## Commit message format
type(scope): short description in imperative mood
Examples:
  feat(llm): switch provider from Gemini to Groq
  fix(auth): wire Supabase JWT verification
  chore(deps): pin Python version, clean up requirements

## PR title
Same as the commit message format.

## PR description — exact sections required:

### Summary
What the PR does and why — the business reason, not just the technical change. Include "Not for merge yet (review pass first)" if it needs review before merging.

### Changes
Grouped by layer with a short description of what changed and why. Use a table or bullets. Be specific — mention file names, function names, RPC names where relevant.

### Deploy status
What's already live, what this changes, what needs to happen after merge (migrations, env vars, secrets, etc.). If nothing needs to change, say so explicitly.

### Verification
How you confirmed it works — commands run, outputs seen, manual testing done, what proves correctness. Be specific.

### Notes (optional)
Anything the reviewer should know that doesn't fit above — gotchas, deferred work, things intentionally left out.

**Footer:** Always end with "🤖 Generated with Claude Code"

## Workflow
1. Create a branch from main (never commit directly to main)
2. Commit all changes to the branch with a proper commit message
3. Push the branch to GitHub
4. Open the PR with the full description above
5. Do NOT merge — wait for my explicit say-so after CodeRabbit reviews
6. If CodeRabbit leaves comments, address them in follow-up commits on the same branch, then re-request review with @CodeRabbit review

## Responding to CodeRabbit
- Address actionable comments in follow-up commits
- For each follow-up commit, add a comment on the PR summarizing what was addressed
- Re-request review after pushing fixes: comment "@CodeRabbit review"
- Do not merge until CodeRabbit passes and I say so