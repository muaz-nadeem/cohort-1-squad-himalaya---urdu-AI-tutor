# MDCAT AI Tutor

Pakistan's first voice-first Urdu AI tutor for MDCAT — explains concepts
conversationally, remembers every mistake, and drills students specifically on
what they keep getting wrong.

This repo implements the full product described in
`MDCAT_AI_Tutor_Full_Documentation.md`.

## Repository layout

```
backend/     FastAPI — STT → RAG → GPT-4o → TTS pipeline + questions,
             attempts, weak-spot engine, sessions, weekly plan
frontend/    Next.js + Tailwind — onboarding, dashboard, study session,
             MCQ flow, Ask AI (voice + text), summary, weak spots, weekly plan
server/      (Optional) Node/Express Uplift Realtime voice-assistant prototype
scripts/     Setup/update helpers for the Uplift Realtime assistant
public/      Static demo page for the Realtime assistant
```

## Architecture

```
┌──────────────┐     REST/JSON      ┌──────────────────────────────┐
│  Next.js UI  │ ─────────────────► │  FastAPI backend             │
│  (frontend/) │ ◄───────────────── │  (backend/app/main.py)       │
└──────────────┘                    │                              │
     │  mic (WebM/Opus)             │  Uplift STT ──(Whisper fb)   │
     │  /api/ask-voice              │  OpenAI embeddings           │
     ▼                              │  Supabase pgvector (RAG)     │
  base64 MP3 + text                 │  GPT-4o (temp 0.3)           │
                                    │  Uplift Orator TTS           │
                                    └──────────────────────────────┘
                                                 │
                                          Supabase Postgres
                                    students · concepts · questions
                                    textbook_chunks · attempts
                                    sessions · weak_spots · weekly_plans
```

## Quick start

### 1. Database (Supabase)
Create a Supabase project, then run `backend/db/schema.sql` in the SQL editor.

### 2. Backend
```bash
cd backend
python -m venv venv && venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env          # fill in OPENAI / UPLIFT / SUPABASE keys
python -m scripts.seed          # load 8 concepts + 13 MCQs
uvicorn app.main:app --reload --port 8000
```

### 3. Frontend
```bash
cd frontend
npm install
copy .env.local.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev                           # http://localhost:3000
```

Open `http://localhost:3000` → onboarding → dashboard → study session.

## API endpoints (backend)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/ask` | POST | Text question → RAG → GPT-4o → answer + audio |
| `/api/ask-voice` | POST | Audio → STT → RAG → GPT-4o → TTS → transcript + answer + audio |
| `/api/explain` | POST | Wrong-answer context → RAG → GPT-4o → explanation |
| `/api/questions` | GET | Next questions by mode + weak-spot profile |
| `/api/attempt` | POST | Log an answer to Supabase |
| `/api/sessions`, `/api/sessions/{id}/end` | POST | Start/end a study session |
| `/api/session-summary` | GET | Session score card |
| `/api/weak-spots` | GET | Ranked weak-concept list |
| `/api/dashboard` | GET | Accuracy, streak, chapter progress, focus |
| `/api/weekly-plan` | GET | Mon–Fri drill plan |
| `/health` | GET | Health + integration status |

## Roadmap coverage

| Phase | Status |
|---|---|
| 1 — Text loop (`/api/explain`, MCQ screen) | ✅ |
| 2 — Real MCQ bank + attempt logging + RAG | ✅ (seed + PDF ingest) |
| 3 — Voice layer (`/api/ask-voice`, STT+TTS) | ✅ |
| 4 — Weak-spot engine + drill mode (1→2→3) | ✅ |
| 5 — Weekly plan + spaced repetition hooks | ✅ (plan) / partial |

## Realtime voice prototype (server/)

The original Uplift Realtime assistant prototype still lives in `server/`,
`scripts/`, and `public/`. It is an alternative low-latency WebRTC voice path.
See `server/README-realtime.md` equivalent notes below or the git history.

```bash
npm install
npm run setup     # register the Uplift Realtime assistant
npm run dev       # http://localhost:3001
```
