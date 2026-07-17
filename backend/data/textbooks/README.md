# FSc Biology textbooks (RAG source)

Drop the complete Punjab Textbook Board Biology PDFs here:

| File | Book id |
|---|---|
| `fsc_biology_part1.pdf` | `fsc_bio_part1` |
| `fsc_biology_part2.pdf` | `fsc_bio_part2` |

Then from `backend/`:

```bash
# 1) Run db/migrate_textbook_chunks.sql in Supabase (once) — recommended
# 2) Optional: install Tesseract OCR for faster local OCR of scanned pages
# 3) Ingest (vision captions + OCR fallback via Groq if Tesseract missing)
python -m scripts.build_biology_rag

# Debug / partial ingest
python -m scripts.build_biology_rag --only fsc_bio_part1 --start-page 20 --max-pages 5
```

Ask with printed page citations:

```bash
curl -X POST http://localhost:8000/api/rag/ask -H "Content-Type: application/json" ^
  -d "{\"question\":\"What kind of digestive system do echinoderms have?\"}"
```

PDFs and `_cache/` are gitignored.
