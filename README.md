# Lens

**Paste a job posting. Get interview questions shaped to that role. Answer them. Get graded like a human would grade you — with the exact phrase you wrote next to every score.**

[![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.136-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Groq](https://img.shields.io/badge/LLM-Groq-F55036)](https://groq.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Live demo:** **[lens-tau-nine.vercel.app](https://lens-tau-nine.vercel.app/)**
> The API runs on Render's free tier, which spins down when idle — the first request after a while can take 30–60s to wake up. Every request after that is instant.

---

## What it is

Lens is a web app for practicing technical interviews. Paste a real job posting, and it generates five interview questions shaped specifically to that role. Answer them one at a time — by typing or by voice — and each answer is scored across four dimensions (not just "good" or "bad") with the exact sentence that earned or cost you points highlighted inline. At the end of a session, Lens looks across your weakest-scoring dimensions and writes you a short, specific "what to study next."

Built for students and job seekers preparing for co-op and internship interviews who want feedback sharper than "looks good."

## Screenshots

| | |
|---|---|
| ![Paste a job posting](docs/screenshots/01-new-session.jpg) **Paste the posting** — Lens turns it into five role-shaped questions. | ![Graded with evidence](docs/screenshots/02-feedback-rubric.jpg) **Graded with evidence** — every score points at the exact phrase that earned it. |
| ![Session summary](docs/screenshots/03-summary.jpg) **Session summary** — every answer, marked up, color-coded by dimension. | ![What to study next](docs/screenshots/04-study-note.jpg) **What to study next** — a targeted note built from your weakest dimensions. |
| ![Session history](docs/screenshots/05-history.jpg) **Session history** — every past session, filed for later. | |

## Key features

- **Four-dimension rubric grading** — every answer is scored on *completeness*, *substance density*, *reasoning*, and *correctness* (1–5 each), not a single opaque number. Each dimension score is backed by a direct quote from the answer, validated server-side against the actual submitted text before it's ever shown.
- **Resume-blended questions** — optionally upload a resume (PDF/DOCX); three of the five questions come from the job posting, two are generated from your actual experience.
- **Prompt-injection–hardened LLM calls** — job postings, resumes, and answers are untrusted user input. They're never placed in the system prompt; they're wrapped, explicitly labeled as data, and isolated from instructions — backed by a dedicated test suite (`tests/test_llm_injection.py`).
- **"What to study next"** — at session close, Lens aggregates your lowest-scoring rubric dimensions across all answered questions into one short, actionable note.
- **Answer by voice** — speech-to-text for answering, plus optional "natural voice" text-to-speech for reading questions aloud (in-browser ONNX model, opt-in — see [Licensing](#licensing)).
- **Skip and resume** — leave any question unanswered and come back; nothing blocks progress through a session.
- **Session history** — every past session is saved and revisitable.

## Tech stack

| Layer | Technology | Why |
|---|---|---|
| Backend | FastAPI (Python 3.12) | Async, typed, self-documenting API |
| Database | PostgreSQL (Supabase) | Relational — sessions and questions are naturally normalized |
| ORM / migrations | SQLAlchemy 2.0 + Alembic | Versioned schema changes, no manual SQL against prod |
| Auth | JWT (PyJWT, HS256) + bcrypt | Stateless auth that scales horizontally; slow, salted password hashing |
| AI | Groq (`openai/gpt-oss-120b`) via the official `groq` SDK | Fast inference, generous free tier, OpenAI-compatible JSON mode |
| Frontend | React 19 + TypeScript + Vite | Type-safe UI, fast dev loop |
| Data fetching | TanStack Query | Cache-aware, resilient to the API's cold starts |
| Styling | Tailwind CSS 4 | Utility-first, no separate design system to maintain |
| Deployment | Render (API) + Vercel (frontend) + Supabase (Postgres) | Free tier across the whole stack |

## Architecture

```mermaid
flowchart LR
    subgraph Client["Browser"]
        FE["React + TypeScript SPA\n(Vercel)"]
    end

    subgraph Server["Render"]
        API["FastAPI\n(JWT auth, validation, orchestration)"]
    end

    DB[("PostgreSQL\n(Supabase)")]
    LLM["Groq API\nopenai/gpt-oss-120b"]

    FE -- "HTTPS + Bearer JWT" --> API
    API -- "SQLAlchemy" --> DB
    API -- "question generation\n+ answer evaluation" --> LLM

    style FE fill:#e0e7ff,stroke:#4338ca,color:#1e1b4b
    style API fill:#dcfce7,stroke:#15803d,color:#052e16
    style DB fill:#fef3c7,stroke:#b45309,color:#451a03
    style LLM fill:#fee2e2,stroke:#b91c1c,color:#450a0a
```

The frontend never talks to Groq directly — every LLM call is proxied and validated by the backend, so the API key never reaches the browser and every response is checked against an expected shape before it's trusted or stored.

## How answer evaluation works

This is the core interaction in the app, and the one with the most engineering behind it:

```mermaid
sequenceDiagram
    autonumber
    participant U as Browser
    participant API as FastAPI
    participant DB as PostgreSQL
    participant G as Groq

    U->>API: POST /sessions/{id}/questions/{qid}/answer
    API->>API: verify JWT, validate request body
    API->>DB: fetch question + parent session (ownership check)
    API->>G: question + answer, wrapped as labeled DATA (JSON mode)
    G-->>API: {completeness, substance, reasoning, correctness}\neach with score + quoted evidence
    API->>API: validate shape, clamp scores 1-5,\nconfirm quotes appear verbatim in the answer,\ncombine into overall score (central-dimension ceiling)
    API->>DB: persist answer, rubric JSON, overall score
    API-->>U: 200 {score, rubric, feedback}
```

If Groq returns something malformed, a quote that doesn't actually appear in the answer, or an out-of-range score, the backend rejects it rather than trusting it blindly — the rubric shown to the user is always grounded in something it independently verified.

## Data model

```mermaid
erDiagram
    USERS ||--o{ SESSIONS : owns
    SESSIONS ||--o{ QUESTIONS : contains

    USERS {
        int id PK
        string email UK
        string display_name
        string password_hash
        timestamp created_at
    }
    SESSIONS {
        int id PK
        int user_id FK
        text job_posting
        text resume_text "nullable"
        string status
        text study_note "nullable, set on close"
        timestamp created_at
        timestamp completed_at "nullable"
    }
    QUESTIONS {
        int id PK
        int session_id FK
        text question_text
        text user_answer "nullable until answered"
        text ai_feedback "nullable until answered"
        jsonb rubric "nullable, per-dimension breakdown"
        int score "1-5, nullable"
        bool skipped
        int order_index
        timestamp answered_at "nullable"
    }
```

Notable decisions:
- A session's overall score is computed dynamically (`AVG` over its questions) rather than stored — it can never drift out of sync with the underlying answers.
- `skipped` is the source of truth for a skipped question, not the absence of an answer — a question can legitimately be unanswered without being skipped (session still in progress).
- Deletes cascade: removing a user removes their sessions, which removes their questions. No orphaned rows.

## API reference

All protected routes require `Authorization: Bearer <jwt>`.

| Method | Path | Auth | Description |
|---|---|:---:|---|
| POST | `/auth/register` | – | Create a new user |
| POST | `/auth/login` | – | Log in, receive a JWT |
| GET | `/auth/me` | ✅ | Current user info |
| POST | `/sessions` | ✅ | Create a session from a job posting |
| GET | `/sessions` | ✅ | List past sessions |
| GET | `/sessions/{id}` | ✅ | Session detail + all questions |
| POST | `/sessions/{id}/resume` | ✅ | Upload a resume (PDF/DOCX) to blend into question generation |
| POST | `/sessions/{id}/questions` | ✅ | Generate the five questions via Groq |
| POST | `/sessions/{id}/questions/{qid}/answer` | ✅ | Submit an answer, get scored |
| POST | `/sessions/{id}/questions/{qid}/skip` | ✅ | Skip a question |
| PATCH | `/sessions/{id}` | ✅ | Close the session (generates the study note) |

## Project structure

```
lens/
├── main.py                  # FastAPI app, CORS, exception handling
├── app/
│   ├── routers/              # auth.py, sessions.py — route handlers
│   ├── models.py              # SQLAlchemy models
│   ├── schemas.py             # Pydantic request/response schemas
│   ├── auth.py                 # JWT issuing/verification, password hashing
│   ├── database.py             # Engine/session setup
│   ├── llm.py                   # Groq integration: question generation, answer evaluation
│   ├── resume.py                # PDF/DOCX parsing, upload guards
│   └── study.py                  # "What to study next" aggregation
├── alembic/                  # Versioned DB migrations
├── tests/                     # pytest suite, incl. prompt-injection isolation tests
├── frontend/
│   └── src/
│       ├── pages/               # Home, Interview, Summary, History, Login
│       ├── components/          # Answer feedback, voice input, layout, UI primitives
│       ├── lib/                 # API client, auth context, rubric logic, TTS worker
│       └── hooks/
└── docs/screenshots/        # README images
```

## Getting started

### Prerequisites
- Python 3.12 (pinned via `.python-version`)
- Node 22 (pinned via `.nvmrc`)
- PostgreSQL (local or a Supabase project)

### Backend

```bash
git clone https://github.com/ltanafranca1004/lens.git
cd lens
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# fill in DATABASE_URL and JWT_SECRET at minimum — see Environment variables below

alembic upgrade head
uvicorn main:app --reload --port 8000
```

Leave `USE_MOCK_LLM=true` (the default) to run the whole app without a Groq API key — question generation and grading return deterministic mock responses instead of calling the real API.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The dev server proxies `/auth` and `/sessions` to `localhost:8000`, so no `VITE_API_URL` is needed locally.

## Environment variables

**Backend (`.env`, copy from `.env.example`):**

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string used by the app and Alembic |
| `JWT_SECRET` | Signing secret for auth tokens — generate with `openssl rand -hex 32` |
| `GROQ_API_KEY` | Groq API key, used only when `USE_MOCK_LLM=false` |
| `USE_MOCK_LLM` | `true` returns canned responses with no API calls; `false` calls Groq |
| `CORS_ORIGINS` | Comma-separated list of allowed browser origins |

**Frontend (`frontend/.env`, copy from `frontend/.env.example`):**

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | API base URL in production; empty locally (uses the Vite proxy) |

## Testing

```bash
source venv/bin/activate
pytest tests/
```

Notable coverage: `tests/test_llm_injection.py` verifies that job postings, resumes, and answers can't manipulate the model into ignoring its scoring instructions; `tests/test_evaluate_answer.py` covers the rubric-combination and evidence-validation logic directly.

## Deployment

The app is deployed exactly as configured in this repo — `render.yaml` (API) and `frontend/vercel.json` (SPA). Render's build step runs `alembic upgrade head` before starting `uvicorn`, so a deploy always ships with an up-to-date schema. Supabase's session-mode connection pooler is used in production since Render's network is IPv4-only.

## Security notes

- Passwords are hashed with bcrypt; never stored or logged in plaintext.
- Auth is stateless JWT (HS256, 7-day expiry) — no server-side session store.
- All LLM prompts treat user-supplied content (job postings, resumes, answers) as **data, never instructions** — wrapped and explicitly labeled, kept out of the system prompt, and covered by a dedicated injection test suite.
- Resume uploads are capped (5 MB) and `.docx` files are checked against their internal zip central directory before parsing, to guard against zip-bomb-style decompression attacks.
- Every LLM response is shape-validated (score ranges, required fields, quotes actually present in the source text) before it's persisted or shown to a user.

## Scope

Lens is intentionally scoped to one loop: **paste a posting → generate questions → answer → get graded → review**. Sign-up/login, question generation, per-question grading with skip support, and session history are the full V1 feature set — deliberately, so the core loop stays sharp instead of half-covering more ground.

What's next: verifying answers against resume claims directly (the resume text is already captured per-session for this), and voice mode polish.

## Licensing

Lens's own code is [MIT-licensed](LICENSE). The optional "natural voice" text-to-speech feature pulls in one GPLv3 component (eSpeak NG, via `kokoro-js`) — see [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md) for the full breakdown. The default voice engine (the browser's built-in `speechSynthesis`) carries no such obligations.

## Author

**Luis Tanafranca** — [github.com/ltanafranca1004](https://github.com/ltanafranca1004)

---

🤖 README generated with [Claude Code](https://claude.com/claude-code), from a live walkthrough of the running app.
