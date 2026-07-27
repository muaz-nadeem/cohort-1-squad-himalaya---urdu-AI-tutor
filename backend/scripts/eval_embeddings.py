"""Evaluate the current embedding model on the queries this app actually gets.

Students ask in Urdu (voice) and English (text), while the corpus is English
FSc Biology. This checks whether the current English-only model retrieves the
same passages for an Urdu question as for its English equivalent.
"""
from __future__ import annotations

from fastembed import TextEmbedding

from app import rag

# (english question, same question in Urdu as Whisper would transcribe it)
PAIRS = [
    (
        "What is the function of mitochondria?",
        "مائٹوکانڈریا کا کام کیا ہے؟",
    ),
    (
        "How do enzymes lower activation energy?",
        "اینزائمز ایکٹیویشن انرجی کو کیسے کم کرتے ہیں؟",
    ),
    (
        "What happens during the light dependent reactions of photosynthesis?",
        "فوٹو سنتھیسز میں لائٹ ڈیپینڈنٹ ری ایکشنز میں کیا ہوتا ہے؟",
    ),
    (
        "Why does high temperature denature proteins?",
        "زیادہ درجہ حرارت پروٹین کو ڈی نیچر کیوں کرتا ہے؟",
    ),
]


def list_multilingual_options() -> None:
    print("=" * 78)
    print("fastembed models (multilingual candidates marked *)")
    print("=" * 78)
    hints = ("multilingual", "m3", "e5", "labse", "paraphrase")
    for model in TextEmbedding.list_supported_models():
        name = model["model"]
        star = "*" if any(h in name.lower() for h in hints) else " "
        size = model.get("size_in_GB", "?")
        print(f" {star} {name:<52}{model['dim']:>5}d  {size}GB")


def page_set(result: dict) -> set:
    return {(s.get("book"), s.get("page_number")) for s in result["sources"]}


def evaluate() -> None:
    print("\n" + "=" * 78)
    print("Urdu vs English retrieval with the CURRENT model (nomic-embed-text-v1.5)")
    print("=" * 78)

    overlaps = []
    for english, urdu in PAIRS:
        en = rag.retrieve_context(english, top_k=3)
        ur = rag.retrieve_context(urdu, top_k=3)

        en_pages, ur_pages = page_set(en), page_set(ur)
        shared = en_pages & ur_pages
        overlap = len(shared) / len(en_pages) if en_pages else 0.0
        overlaps.append(overlap)

        en_sim = [s["similarity"] for s in en["sources"]]
        ur_sim = [s["similarity"] for s in ur["sources"]]

        print(f"\nQ: {english}")
        print(f"   EN -> {len(en_pages)} pages, similarity {en_sim}")
        print(f"   UR -> {len(ur_pages)} pages, similarity {ur_sim}")
        print(f"   same passages retrieved: {overlap:.0%}")
        if not ur_pages:
            print("   URDU RETRIEVED NOTHING (all chunks below the 0.35 threshold)")

    mean = sum(overlaps) / len(overlaps) if overlaps else 0
    print("\n" + "-" * 78)
    print(f"mean Urdu/English agreement: {mean:.0%}")
    print("(100% = Urdu questions retrieve the same textbook pages as English)")


if __name__ == "__main__":
    list_multilingual_options()
    evaluate()
