"""Canonical MDCAT Biology chapter catalog for practice / custom quiz."""
from __future__ import annotations

import re

BIOLOGY_CHAPTERS: list[dict[str, str]] = [
    {"id": "cell_structure", "name": "Cell Structure and Function", "book": "fsc_part1"},
    {"id": "biological_molecules", "name": "Biological Molecules", "book": "fsc_part1"},
    {"id": "enzymes", "name": "Enzymes", "book": "fsc_part1"},
    {"id": "bioenergetics", "name": "Bioenergetics", "book": "fsc_part1"},
    {"id": "acellular_life", "name": "Acellular Life", "book": "fsc_part1"},
    {"id": "prokaryotes", "name": "Prokaryotes", "book": "fsc_part1"},
    {"id": "protists_fungi", "name": "Protists and Fungi", "book": "fsc_part1"},
    {"id": "diversity_plants", "name": "Diversity Among Plants", "book": "fsc_part1"},
    {"id": "diversity_animals", "name": "Diversity Among Animals", "book": "fsc_part1"},
    {"id": "homeostasis", "name": "Homeostasis", "book": "fsc_part2"},
    {"id": "support_movement", "name": "Support and Movement", "book": "fsc_part2"},
    {"id": "coordination_control", "name": "Coordination and Control", "book": "fsc_part2"},
    {"id": "reproduction", "name": "Reproduction", "book": "fsc_part2"},
    {"id": "growth_development", "name": "Growth and Development", "book": "fsc_part2"},
    {"id": "inheritance", "name": "Inheritance", "book": "fsc_part2"},
    {"id": "chromosome_dna", "name": "Chromosome and DNA", "book": "fsc_part2"},
    {"id": "evolution", "name": "Evolution", "book": "fsc_part2"},
    {"id": "man_environment", "name": "Man and His Environment", "book": "fsc_part2"},
    {"id": "biotechnology", "name": "Biotechnology", "book": "fsc_part2"},
    {"id": "circulation_immunity", "name": "Circulation and Immunity", "book": "fsc_part2"},
    {"id": "nutrition_gases", "name": "Life Processes (Nutrition & Gaseous Exchange)", "book": "fsc_part2"},
    {"id": "variation_genetics", "name": "Variation and Genetics", "book": "fsc_part2"},
]

# KIPS unit numbers — longest / most specific first (unit 10 before unit 1)
_UNIT_CHAPTER: list[tuple[int, str]] = [
    (10, "Variation and Genetics"),
    (9, "Reproduction"),
    (8, "Coordination and Control"),
    (7, "Circulation and Immunity"),
    (6, "Life Processes (Nutrition & Gaseous Exchange)"),
    (5, "Homeostasis"),
    (4, "Acellular Life"),
    (3, "Bioenergetics"),
    (2, "Biological Molecules"),
    (1, "Cell Structure and Function"),
]

# Keyword aliases (checked after unit number). Longer / specific first.
CHAPTER_ALIASES: list[tuple[str, str]] = [
    ("cell structure", "Cell Structure and Function"),
    ("biological molecule", "Biological Molecules"),
    ("bioenergetic", "Bioenergetics"),
    ("enzyme", "Enzymes"),
    ("acellular", "Acellular Life"),
    ("virus", "Acellular Life"),
    ("homeostasis", "Homeostasis"),
    ("nutrition", "Life Processes (Nutrition & Gaseous Exchange)"),
    ("gaseous", "Life Processes (Nutrition & Gaseous Exchange)"),
    ("circulation", "Circulation and Immunity"),
    ("immunit", "Circulation and Immunity"),
    ("coordination", "Coordination and Control"),
    ("reproduction", "Reproduction"),
    ("support and movement", "Support and Movement"),
    ("variation", "Variation and Genetics"),
    ("inheritance", "Variation and Genetics"),
    ("prokaryot", "Prokaryotes"),
    ("protist", "Protists and Fungi"),
    ("fungi", "Protists and Fungi"),
    ("diversity among plant", "Diversity Among Plants"),
    ("diversity among animal", "Diversity Among Animals"),
    ("chromosome", "Chromosome and DNA"),
    ("evolution", "Evolution"),
    ("environment", "Man and His Environment"),
    ("biotechnolog", "Biotechnology"),
    ("growth and development", "Growth and Development"),
]

_UNIT_RE = re.compile(
    r"unit\s*[#\-.]?\s*(\d{1,2})\b",
    re.IGNORECASE,
)


def infer_chapter_from_text(text: str) -> str | None:
    lower = (text or "").lower()

    # Prefer explicit unit number (avoids unit#1 matching inside unit#10)
    m = _UNIT_RE.search(lower)
    if m:
        num = int(m.group(1))
        for unit_n, chapter in _UNIT_CHAPTER:
            if unit_n == num:
                return chapter

    for needle, chapter in CHAPTER_ALIASES:
        if needle in lower:
            return chapter
    return None


def list_chapters() -> list[dict[str, str]]:
    return list(BIOLOGY_CHAPTERS)
