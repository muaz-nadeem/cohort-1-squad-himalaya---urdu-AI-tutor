"""Ingest an FSc textbook PDF into Supabase pgvector.

Usage:
    python -m scripts.ingest_pdf path/to/fsc_biology.pdf --concept "Cell Biology" --chapter "Chapter 4"

Steps (matches the documented RAG pipeline):
    1. Chunk the PDF (~500 words/chunk) with PyMuPDF
    2. Embed each chunk locally with fastembed (nomic-embed-text-v1.5)
    3. Store content + embedding in the textbook_chunks table
"""
from __future__ import annotations

import argparse
import sys

import fitz  # PyMuPDF

sys.path.append(".")

from app.config import settings  # noqa: E402
from app.db import require_client  # noqa: E402
from app.rag import embed  # noqa: E402


def chunk_pdf(pdf_path: str, chunk_size: int = 500) -> list[str]:
    doc = fitz.open(pdf_path)
    chunks: list[str] = []
    current_chunk = ""

    for page in doc:
        text = page.get_text()
        for word in text.split():
            current_chunk += word + " "
            if len(current_chunk.split()) >= chunk_size:
                chunks.append(current_chunk.strip())
                current_chunk = ""

    if current_chunk.strip():
        chunks.append(current_chunk.strip())
    return chunks


def embed_and_store(chunks: list[str], concept_name: str, chapter: str) -> int:
    supabase = require_client()
    stored = 0

    for i, chunk in enumerate(chunks, 1):
        embedding = embed(chunk)
        if embedding is None:
            print(f"  skipped chunk {i} (embedding failed)")
            continue
        supabase.table("textbook_chunks").insert(
            {
                "content": chunk,
                "embedding": embedding,
                "concept": concept_name,
                "chapter": chapter,
            }
        ).execute()
        stored += 1
        print(f"  stored chunk {i}/{len(chunks)}")

    return stored


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest an FSc textbook PDF into pgvector")
    parser.add_argument("pdf_path", help="Path to the FSc textbook PDF")
    parser.add_argument("--concept", required=True, help="Concept name for these chunks")
    parser.add_argument("--chapter", required=True, help="Chapter label")
    parser.add_argument("--chunk-size", type=int, default=500)
    args = parser.parse_args()

    if not settings.supabase_ready:
        sys.exit("SUPABASE_URL/SUPABASE_KEY must be set in .env")

    print(f"Chunking {args.pdf_path} ...")
    chunks = chunk_pdf(args.pdf_path, args.chunk_size)
    print(f"  {len(chunks)} chunks")

    print("Embedding + storing ...")
    n = embed_and_store(chunks, args.concept, args.chapter)
    print(f"Done. Stored {n} chunks for concept '{args.concept}'.")


if __name__ == "__main__":
    main()
