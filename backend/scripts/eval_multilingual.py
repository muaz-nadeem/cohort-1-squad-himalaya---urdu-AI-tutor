"""Offline bake-off: can a multilingual embedding model fix Urdu retrieval?

Pulls real textbook chunks from Supabase, embeds them in memory with each
candidate model, and checks whether an Urdu question ranks the same passages
as its English twin. No re-ingest required to run this.
"""
from __future__ import annotations

import time

import numpy as np
from fastembed import TextEmbedding

from app import db

CANDIDATES = [
    # (model name, query prefix, document prefix)  -- prefixes per model card
    ("nomic-ai/nomic-embed-text-v1.5", "search_query: ", "search_document: "),
    ("sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2", "", ""),
    ("sentence-transformers/paraphrase-multilingual-mpnet-base-v2", "", ""),
]

PAIRS = [
    ("What is the function of mitochondria?", "مائٹوکانڈریا کا کام کیا ہے؟"),
    ("How do enzymes lower activation energy?", "اینزائمز ایکٹیویشن انرجی کو کیسے کم کرتے ہیں؟"),
    (
        "What happens during the light dependent reactions of photosynthesis?",
        "فوٹو سنتھیسز میں لائٹ ڈیپینڈنٹ ری ایکشنز میں کیا ہوتا ہے؟",
    ),
    ("Why does high temperature denature proteins?", "زیادہ درجہ حرارت پروٹین کو ڈی نیچر کیوں کرتا ہے؟"),
    ("What is the structure of DNA?", "ڈی این اے کی ساخت کیا ہے؟"),
]

CORPUS_SIZE = 400
TOP_K = 3


def load_corpus() -> list[str]:
    rows = (
        db.require_client()
        .table("textbook_chunks")
        .select("content")
        .limit(CORPUS_SIZE)
        .execute()
        .data
    )
    return [r["content"] for r in rows if r.get("content")]


def normalise(matrix: np.ndarray) -> np.ndarray:
    return matrix / np.clip(np.linalg.norm(matrix, axis=1, keepdims=True), 1e-9, None)


def evaluate(model_name: str, q_prefix: str, d_prefix: str, corpus: list[str]) -> None:
    start = time.perf_counter()
    model = TextEmbedding(model_name=model_name)
    load_s = time.perf_counter() - start

    start = time.perf_counter()
    doc_vecs = normalise(np.array(list(model.embed([d_prefix + c for c in corpus]))))
    embed_s = time.perf_counter() - start

    overlaps, en_scores, ur_scores = [], [], []
    for english, urdu in PAIRS:
        q = normalise(np.array(list(model.embed([q_prefix + english, q_prefix + urdu]))))
        sims_en = doc_vecs @ q[0]
        sims_ur = doc_vecs @ q[1]

        top_en = set(np.argsort(-sims_en)[:TOP_K].tolist())
        top_ur = set(np.argsort(-sims_ur)[:TOP_K].tolist())
        overlaps.append(len(top_en & top_ur) / TOP_K)
        en_scores.append(float(sims_en.max()))
        ur_scores.append(float(sims_ur.max()))

    agreement = sum(overlaps) / len(overlaps)
    print(f"\n{model_name}")
    print(f"  load {load_s:5.1f}s | embed {len(corpus)} chunks {embed_s:5.1f}s "
          f"| {embed_s / len(corpus) * 1000:.1f}ms per chunk")
    print(f"  top-{TOP_K} Urdu/English agreement : {agreement:6.0%}")
    print(f"  best similarity  English         : {sum(en_scores)/len(en_scores):6.3f}")
    print(f"  best similarity  Urdu            : {sum(ur_scores)/len(ur_scores):6.3f}")
    per_q = "  ".join(f"{o:.0%}" for o in overlaps)
    print(f"  per question                     : {per_q}")


def main() -> None:
    corpus = load_corpus()
    print(f"corpus: {len(corpus)} real textbook chunks from Supabase")
    print(f"scoring top-{TOP_K} overlap between each Urdu question and its English twin")

    for name, q_prefix, d_prefix in CANDIDATES:
        try:
            evaluate(name, q_prefix, d_prefix, corpus)
        except Exception as exc:
            print(f"\n{name}\n  FAILED: {type(exc).__name__}: {exc}")


if __name__ == "__main__":
    main()
