# Practice resources (MCQ bank + mnemonics)

Drop / keep PDFs in these folders (already present in this repo layout):

| Folder | Role | `source_type` |
|--------|------|---------------|
| `Biology/` | KIPS unit tests | `academy_test` |
| `FLPs/` | KIPS FLPs | `flp` |
| `KIPS FLPS MDCAT (1680MCQS)/` | More FLPs | `flp` |
| `STEPS MDCAT TESTS (4500MCQS)/` | Step tests | `academy_test` |
| `most repeated mcqs/` | High-yield repeats | `most_repeated` |
| `other resources/` | Past papers | `past_paper` |
| `other resources/MDCAT-MNEMONIC-2023.pdf` | Memory tips (not MCQs) | → `mnemonic_chunks` |
| `textbooks/` | FSc books for Ask AI only | (RAG) |

## Setup

1. Run `db/migrate_mcq_practice.sql` in Supabase (or use updated `schema.sql` on a fresh DB).
2. From `backend/`:

```bash
# Smoke: 1 PDF, first 3 pages
python -m scripts.ingest_mcqs --max-pdfs 1 --max-pages 3

# Full batch (embedded text or Tesseract OCR → cheap text model for JSON)
# Requires Tesseract OCR installed for scanned/CamScanner PDFs
# MCQs without a marked answer in the source are dropped (no LLM guessing)
python -m scripts.ingest_mcqs

# Mnemonics for explanations
python -m scripts.ingest_mnemonics
```

Extracted JSON lands in `data/_extracted/` for review.

## How the platform uses the bank

- **Chapter practice (100):** random mix from **all** source types for that chapter.
- **Platform FLP (81):** our own Biology paper — mix from the **entire** bank (never one FLP PDF as-is).
- **Diagnostic (25):** mix across chapters.
- **Custom quiz:** your chapter counts; each slice still mixed from the bank.
