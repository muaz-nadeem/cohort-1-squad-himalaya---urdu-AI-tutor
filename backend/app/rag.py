"""RAG retrieval: embed a query, pull the closest FSc textbook chunks.

Embeddings run locally via fastembed (nomic-embed-text-v1.5, 768-dim ONNX).
Retrieved chunks include book + printed page_number for citations.

Nomic embed models use task prefixes:
  - "search_query: " for queries
  - "search_document: " for documents (applied at ingest time)
"""
from __future__ import annotations

import re
from functools import lru_cache
from typing import Optional

from .config import settings
from . import db

BOOK_LABELS = {
    "fsc_bio_part1": "FSc Biology Part 1",
    "fsc_bio_part2": "FSc Biology Part 2",
}


def book_display_name(book: str) -> str:
    return BOOK_LABELS.get(book, book)

_HEADER_RE = re.compile(
    r"\[([^\]]+?)\s*(?:·|-)\s*p\.\s*(\d+)\s*(?:·|-)\s*(text|figure|table)\]",
    re.IGNORECASE,
)
_LEGACY_CHAPTER_RE = re.compile(
    r"^(fsc_bio_part[12])\|p(\d+)\|(text|figure|table)\|(.*)$"
)

# Textbook coverage is partial (~600 chunks), so keep this permissive enough to
# surface a relevant passage when one exists; the explain endpoint still falls
# back to the MCQ's own exam source when nothing clears the bar.
SIMILARITY_THRESHOLD = 0.3

# Prompt size dominates answer latency: past ~5k chars of context, Groq requests
# jump from ~1.5s to 15s+ (token-per-minute throttling). Cap what we send.
MAX_CONTEXT_CHARS = 4500

_embedding_model = None
_model_loaded = False


def _get_embedding_model():
    global _embedding_model, _model_loaded
    if _model_loaded:
        return _embedding_model
    try:
        from fastembed import TextEmbedding

        _embedding_model = TextEmbedding(model_name="nomic-ai/nomic-embed-text-v1.5")
        _model_loaded = True
        return _embedding_model
    except Exception:
        return None


def warmup() -> None:
    """Pre-load the embedding model and run a throwaway embed to warm ONNX."""
    model = _get_embedding_model()
    if model is not None:
        list(model.embed(["warmup"]))
        print("  [rag] embedding model warmed up")


def embed(text: str, *, is_query: bool = False) -> Optional[list[float]]:
    """Embed text. Use is_query=True for search queries (adds nomic prefix)."""
    model = _get_embedding_model()
    if model is None:
        print("  [embed] model unavailable (is fastembed installed in this Python?)")
        return None
    try:
        prefixed = f"search_query: {text}" if is_query else f"search_document: {text}"
        embeddings = list(model.embed([prefixed]))
        vec = embeddings[0]
        return vec.tolist() if hasattr(vec, "tolist") else list(vec)
    except Exception as exc:
        print(f"  [embed] error: {type(exc).__name__}: {exc}")
        return None


def _enrich_chunk(chunk: dict) -> dict:
    """Fill book/page/content_type from columns or legacy encodings."""
    out = dict(chunk)
    if out.get("page_number") is not None and out.get("book"):
        return out

    chapter = out.get("chapter") or ""
    m = _LEGACY_CHAPTER_RE.match(chapter)
    if m:
        out["book"] = out.get("book") or m.group(1)
        out["page_number"] = out.get("page_number") or int(m.group(2))
        out["content_type"] = out.get("content_type") or m.group(3)
        out["chapter"] = m.group(4)

    if out.get("page_number") is None:
        hm = _HEADER_RE.search(out.get("content") or "")
        if hm:
            label = hm.group(1).strip()
            out["page_number"] = int(hm.group(2))
            out["content_type"] = out.get("content_type") or hm.group(3).lower()
            if "Part 2" in label:
                out["book"] = out.get("book") or "fsc_bio_part2"
            elif "Part 1" in label:
                out["book"] = out.get("book") or "fsc_bio_part1"
    return out


def _format_context_block(chunk: dict) -> str:
    content = chunk.get("content") or ""
    if _HEADER_RE.search(content.split("\n", 1)[0] if content else ""):
        return content

    book = book_display_name(chunk.get("book") or "")
    page = chunk.get("page_number")
    ctype = chunk.get("content_type") or "text"
    page_bit = f"p. {page}" if page is not None else "p. ?"
    header = f"[{book} - {page_bit} - {ctype}]"
    return f"{header}\n{content}"


def retrieve_context(
    query: str,
    top_k: int = 3,
    concept: Optional[str] = None,
    book: Optional[str] = None,
    similarity_threshold: float = SIMILARITY_THRESHOLD,
    max_context_chars: int = MAX_CONTEXT_CHARS,
) -> dict:
    """Return { context, sources } with printed page metadata."""
    embedding = embed(query, is_query=True)
    if embedding is None or not settings.supabase_ready:
        return {"context": "", "sources": []}

    try:
        chunks = db.match_chunks(
            embedding, match_count=top_k, concept=concept, book=book
        )
    except Exception:
        try:
            chunks = db.require_client().rpc(
                "match_chunks",
                {
                    "query_embedding": embedding,
                    "match_count": top_k,
                    "filter_concept": concept,
                },
            ).execute().data or []
        except Exception:
            return {"context": "", "sources": []}

    enriched = [_enrich_chunk(c) for c in chunks]
    if book:
        enriched = [c for c in enriched if c.get("book") == book]

    # Filter by similarity threshold
    enriched = [
        c for c in enriched
        if c.get("similarity", 0) >= similarity_threshold
    ]

    # Keep the highest-similarity chunks that fit the budget; drop the rest so a
    # few oversized chunks cannot blow up answer latency.
    if max_context_chars:
        enriched.sort(key=lambda c: c.get("similarity", 0), reverse=True)
        kept: list[dict] = []
        used = 0
        for chunk in enriched:
            block_len = len(_format_context_block(chunk)) + 2
            if kept and used + block_len > max_context_chars:
                continue
            kept.append(chunk)
            used += block_len
        enriched = kept

    context = "\n\n".join(_format_context_block(c) for c in enriched)
    sources = [
        {
            "book": c.get("book"),
            "book_label": book_display_name(c.get("book") or ""),
            "chapter": c.get("chapter"),
            "page_number": c.get("page_number"),
            "content_type": c.get("content_type"),
            "concept": c.get("concept"),
            "similarity": round(c.get("similarity", 0), 3),
            "snippet": (c.get("content") or "")[:220],
        }
        for c in enriched
    ]
    return {"context": context, "sources": sources}


def retrieve_mnemonics(query: str, top_k: int = 3) -> dict:
    """Return { context, sources } from mnemonic_chunks."""
    embedding = embed(query, is_query=True)
    if embedding is None or not settings.supabase_ready:
        return {"context": "", "sources": []}
    try:
        chunks = db.match_mnemonic_chunks(embedding, match_count=top_k)
    except Exception:
        return {"context": "", "sources": []}
    context = "\n\n".join(
        f"[Mnemonic p. {c.get('page_number') or '?'}]\n{c.get('content') or ''}"
        for c in chunks
    )
    sources = [
        {
            "topic": c.get("topic"),
            "page_number": c.get("page_number"),
            "similarity": round(c.get("similarity", 0), 3),
            "snippet": (c.get("content") or "")[:200],
        }
        for c in chunks
    ]
    return {"context": context, "sources": sources}


def format_citation(sources: list[dict]) -> Optional[str]:
    """Build citation lines with printed page numbers.

    Example: 'FSc Biology Part 1 · p. 84, 86 · PTB'
    """
    short = format_citation_short(sources)
    if not short:
        return None
    return f"{short} | PTB"


def format_citation_short(sources: list[dict]) -> Optional[str]:
    """Book + page only. Example: 'FSc Biology Part 1, p. 84'"""
    if not sources:
        return None

    by_book: dict[str, set[int]] = {}
    for s in sources:
        label = s.get("book_label") or book_display_name(s.get("book") or "") or "FSc Biology"
        page = s.get("page_number")
        if page is None:
            continue
        by_book.setdefault(label, set()).add(int(page))

    if not by_book:
        return None

    bits = []
    for label, pages in by_book.items():
        page_list = ", ".join(str(p) for p in sorted(pages))
        bits.append(f"{label}, p. {page_list}")
    return " | ".join(bits)
