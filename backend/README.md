# MDCAT AI Tutor — Backend (FastAPI)

Orchestrates the voice + RAG pipeline and serves all app data.

```
Ask AI (voice)                Ask AI (text)             Wrong answer
      │                             │                        │
      ▼                             ▼                        ▼
/api/ask-voice                 /api/ask                 /api/explain
      │                             │                        │
Uplift STT ──► (Whisper fallback)   │                        │
      └────────────┬────────────────┘                        │
                   ▼                                          │
          RAG: embed query ──► Supabase pgvector match_chunks │
                   │                                          │
                   ▼                                          ▼
          Groq LLM (temp 0.3, textbook-grounded + page cites)
                   │
                   ▼
          Uplift Orator TTS ──► base64 MP3 + text + citation
```

## Multimodal FSc Biology RAG

1. Drop PDFs in `data/textbooks/` as `fsc_biology_part1.pdf` and `fsc_biology_part2.pdf`
2. Run `db/migrate_textbook_chunks.sql` in Supabase (if you already applied the older schema)
3. Install Tesseract OCR for scanned pages
4. Ingest:

```bash
python -m scripts.build_biology_rag
# debug: python -m scripts.build_biology_rag --max-pages 5
```

5. Ask with printed page citations:

```bash
curl -X POST http://localhost:8000/api/rag/ask \
  -H "Content-Type: application/json" \
  -d '{"question":"What does the mitochondrion diagram show?"}'
```

Ingest uses local fastembed + Groq Llama-4 Scout vision for figures/tables.

## Layout

| Path | Purpose |
|---|---|
| `app/main.py` | FastAPI app + all endpoints |
| `app/config.py` | Env/config loader |
| `app/db.py` | Supabase data-access layer |
| `app/rag.py` | Embed query + retrieve textbook chunks + page citation |
| `app/llm.py` | Groq prompts + generation |
| `app/textbook_rag/` | PDF extract, vision captions, chunk, ingest |
| `app/voice.py` | Uplift STT (+ Whisper fallback) and Orator TTS |
| `app/weak_spots.py` | Accuracy, priority score, mastery detection |
| `app/study.py` | Diagnostic vs Drill mode + question selection |
| `app/planner.py` | Weekly plan generator |
| `db/schema.sql` | Supabase tables + pgvector + `match_chunks` RPC |
| `db/migrate_textbook_chunks.sql` | Migration for multimodal columns |
| `data/seed_biology.json` | 8 concepts + 13 tagged MCQs |
| `data/textbooks/` | Drop FSc Biology Part 1/2 PDFs here |
| `scripts/seed.py` | Load seed data into Supabase |
| `scripts/build_biology_rag.py` | Multimodal ingest for Part 1 + Part 2 |
| `scripts/ingest_pdf.py` | Legacy single-PDF ingest |
| `scripts/generate_weekly_plans.py` | Sunday-night plan generation |

## Setup

```bash
cd backend
python -m venv venv
venv\Scripts\activate            # Windows
# source venv/bin/activate       # macOS/Linux
pip install -r requirements.txt

cp .env.example .env             # fill in your keys
```

Then in the Supabase SQL editor, run `db/schema.sql` once.

```bash
python -m scripts.seed           # load concepts + questions
uvicorn app.main:app --reload --port 8000
curl http://localhost:8000/health
```

## Graceful degradation

The server boots and answers even without keys:
- No OpenAI key → RAG returns empty context; explanations require the key to generate text.
- No Supabase → question/attempt/weak-spot endpoints raise a clear error; voice/ask still run.
- No Uplift key → text answers work, `audio` is returned as `null`.

`/health` reports which integrations are live.

## Ingesting a textbook PDF

```bash
python -m scripts.ingest_pdf ./fsc_biology_part1.pdf --concept "Mitochondria" --chapter "Cell Biology"
```
