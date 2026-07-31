"""Canonical MDCAT Biology chapter catalog for practice / custom quiz.

Aligned with the official MDCAT 2026 Biology syllabus (16 units).
"""
from __future__ import annotations

import re

# `book` = FSc year the chapter is taught in (fsc_part1 = 1st year, fsc_part2 =
# 2nd year). Used by the frontend 1st/2nd-year filter so every chapter renders.
BIOLOGY_CHAPTERS: list[dict[str, str]] = [
    {"id": "acellular_life", "name": "Acellular Life", "unit": "1", "book": "fsc_part1"},
    {"id": "bioenergetics", "name": "Bioenergetics", "unit": "2", "book": "fsc_part1"},
    {"id": "biological_molecules", "name": "Biological Molecules", "unit": "3", "book": "fsc_part1"},
    {"id": "cell_structure", "name": "Cell Structure and Function", "unit": "4", "book": "fsc_part1"},
    {"id": "coordination_control", "name": "Coordination and Control", "unit": "5", "book": "fsc_part2"},
    {"id": "enzymes", "name": "Enzymes", "unit": "6", "book": "fsc_part1"},
    {"id": "evolution", "name": "Evolution", "unit": "7", "book": "fsc_part2"},
    {"id": "reproduction", "name": "Reproduction", "unit": "8", "book": "fsc_part2"},
    {"id": "support_movement", "name": "Support and Movement", "unit": "9", "book": "fsc_part2"},
    {"id": "inheritance", "name": "Inheritance", "unit": "10", "book": "fsc_part2"},
    {"id": "circulation", "name": "Circulation", "unit": "11", "book": "fsc_part1"},
    {"id": "immunity", "name": "Immunity", "unit": "12", "book": "fsc_part1"},
    {"id": "respiration", "name": "Respiration", "unit": "13", "book": "fsc_part1"},
    {"id": "digestion", "name": "Digestion", "unit": "14", "book": "fsc_part1"},
    {"id": "homeostasis", "name": "Homeostasis", "unit": "15", "book": "fsc_part2"},
    {"id": "biotechnology", "name": "Biotechnology", "unit": "16", "book": "fsc_part2"},
]

# KIPS unit numbers — longest / most specific first (unit 10 before unit 1)
_UNIT_CHAPTER: list[tuple[int, str]] = [
    (10, "Inheritance"),
    (9, "Support and Movement"),
    (8, "Reproduction"),
    (7, "Evolution"),
    (6, "Coordination and Control"),
    (5, "Homeostasis"),
    (4, "Acellular Life"),
    (3, "Bioenergetics"),
    (2, "Biological Molecules"),
    (1, "Cell Structure and Function"),
]

# Keyword aliases (checked after unit number). Longer / most specific first.
CHAPTER_ALIASES: list[tuple[str, str]] = [
    # --- titles / explicit ---
    ("cell structure", "Cell Structure and Function"),
    ("biological molecule", "Biological Molecules"),
    ("bioenergetic", "Bioenergetics"),
    ("support and movement", "Support and Movement"),
    ("coordination and control", "Coordination and Control"),
    # --- cell ---
    ("endoplasmic reticulum", "Cell Structure and Function"),
    ("middle lamella", "Cell Structure and Function"),
    ("plasma membrane", "Cell Structure and Function"),
    ("unit membrane", "Cell Structure and Function"),
    ("cell membrane", "Cell Structure and Function"),
    ("cell wall", "Cell Structure and Function"),
    ("animal cell", "Cell Structure and Function"),
    ("plant cell", "Cell Structure and Function"),
    ("food vacuole", "Cell Structure and Function"),
    ("mitochondri", "Cell Structure and Function"),
    ("chloroplast", "Cell Structure and Function"),
    ("plastid", "Cell Structure and Function"),
    ("ribosom", "Cell Structure and Function"),
    ("lysosom", "Cell Structure and Function"),
    ("peroxisom", "Cell Structure and Function"),
    ("golgi", "Cell Structure and Function"),
    ("centriole", "Cell Structure and Function"),
    ("cytoskeleton", "Cell Structure and Function"),
    ("nucleolus", "Cell Structure and Function"),
    ("nucleoplasm", "Cell Structure and Function"),
    ("organelle", "Cell Structure and Function"),
    ("vacuol", "Cell Structure and Function"),
    ("cytoplasm", "Cell Structure and Function"),
    ("mitosis", "Cell Structure and Function"),
    ("meiosis", "Cell Structure and Function"),
    ("cell cycle", "Cell Structure and Function"),
    ("turgor", "Cell Structure and Function"),
    ("prokaryot", "Cell Structure and Function"),
    ("eukaryot", "Cell Structure and Function"),
    # --- molecules ---
    ("amino acid", "Biological Molecules"),
    ("peptide bond", "Biological Molecules"),
    ("fatty acid", "Biological Molecules"),
    ("reducing sugar", "Biological Molecules"),
    ("monosaccharide", "Biological Molecules"),
    ("disaccharide", "Biological Molecules"),
    ("polysaccharide", "Biological Molecules"),
    ("carbohydrate", "Biological Molecules"),
    ("biomolecule", "Biological Molecules"),
    ("glucose", "Biological Molecules"),
    ("fructose", "Biological Molecules"),
    ("sucrose", "Biological Molecules"),
    ("starch", "Biological Molecules"),
    ("cellulose", "Biological Molecules"),
    ("glycogen", "Biological Molecules"),
    ("lipid", "Biological Molecules"),
    ("protein", "Biological Molecules"),
    ("triglyceride", "Biological Molecules"),
    ("phospholipid", "Biological Molecules"),
    ("water vaporiz", "Biological Molecules"),
    ("double helix", "Biological Molecules"),
    ("nucleotide", "Biological Molecules"),
    ("nucleic acid", "Biological Molecules"),
    (" dna", "Biological Molecules"),
    ("dna ", "Biological Molecules"),
    (" rna", "Biological Molecules"),
    ("mrna", "Biological Molecules"),
    ("trna", "Biological Molecules"),
    ("rrna", "Biological Molecules"),
    ("watson", "Biological Molecules"),
    ("crick", "Biological Molecules"),
    ("conjugated molecule", "Biological Molecules"),
    ("glycolipid", "Biological Molecules"),
    ("glycoprotein", "Biological Molecules"),
    # --- enzymes ---
    ("active site", "Enzymes"),
    ("enzyme", "Enzymes"),
    ("substrate", "Enzymes"),
    ("coenzyme", "Enzymes"),
    ("cofactor", "Enzymes"),
    ("activation energy", "Enzymes"),
    ("lock and key", "Enzymes"),
    ("induced fit", "Enzymes"),
    ("inhibitor", "Enzymes"),
    # --- bioenergetics ---
    ("electron transport", "Bioenergetics"),
    ("light dependent", "Bioenergetics"),
    ("light independent", "Bioenergetics"),
    ("photosynthe", "Bioenergetics"),
    ("cellular respiration", "Bioenergetics"),
    ("glycolysis", "Bioenergetics"),
    ("krebs", "Bioenergetics"),
    ("calvin", "Bioenergetics"),
    ("fermentation", "Bioenergetics"),
    ("oxidative phosphorylation", "Bioenergetics"),
    ("nadh", "Bioenergetics"),
    ("fadh", "Bioenergetics"),
    (" atp", "Bioenergetics"),
    ("atp ", "Bioenergetics"),
    # --- acellular life ---
    ("bacteriophage", "Acellular Life"),
    ("acellular", "Acellular Life"),
    ("capsid", "Acellular Life"),
    ("prion", "Acellular Life"),
    ("viroid", "Acellular Life"),
    ("virus", "Acellular Life"),
    ("viral", "Acellular Life"),
    ("hiv", "Acellular Life"),
    ("aids", "Acellular Life"),
    # --- homeostasis ---
    ("homeostasis", "Homeostasis"),
    ("osmoregul", "Homeostasis"),
    ("nephron", "Homeostasis"),
    ("kidney", "Homeostasis"),
    ("urea", "Homeostasis"),
    ("excretion", "Homeostasis"),
    ("thermoregul", "Homeostasis"),
    ("glomerular", "Homeostasis"),
    ("tubular secretion", "Homeostasis"),
    ("kidney stone", "Homeostasis"),
    ("nitrogenous", "Homeostasis"),
    # --- support & movement ---
    ("skeleton", "Support and Movement"),
    ("cartilage", "Support and Movement"),
    ("sarcomere", "Support and Movement"),
    ("myosin", "Support and Movement"),
    ("actin", "Support and Movement"),
    ("muscle", "Support and Movement"),
    ("bone", "Support and Movement"),
    ("joint", "Support and Movement"),
    ("arthritis", "Support and Movement"),
    ("skeletal muscle", "Support and Movement"),
    ("cardiac muscle", "Support and Movement"),
    ("smooth muscle", "Support and Movement"),
    # --- coordination & control ---
    ("neuron", "Coordination and Control"),
    ("synapse", "Coordination and Control"),
    ("nervous", "Coordination and Control"),
    ("reflex", "Coordination and Control"),
    ("hormone", "Coordination and Control"),
    ("pituitary", "Coordination and Control"),
    ("thyroid", "Coordination and Control"),
    ("adrenal", "Coordination and Control"),
    ("insulin", "Coordination and Control"),
    ("axon", "Coordination and Control"),
    ("dendrite", "Coordination and Control"),
    ("nerve impulse", "Coordination and Control"),
    ("myelin", "Coordination and Control"),
    ("cerebr", "Coordination and Control"),
    ("brain stem", "Coordination and Control"),
    ("cerebellum", "Coordination and Control"),
    ("receptor", "Coordination and Control"),
    # --- reproduction ---
    ("reproduct", "Reproduction"),
    ("gametogenesis", "Reproduction"),
    ("spermatogenesis", "Reproduction"),
    ("oogenesis", "Reproduction"),
    ("gamete", "Reproduction"),
    ("zygote", "Reproduction"),
    ("fertilization", "Reproduction"),
    ("fertilisation", "Reproduction"),
    ("menstrual", "Reproduction"),
    ("sexually transmitted", "Reproduction"),
    # --- inheritance ---
    ("allele", "Inheritance"),
    ("genotype", "Inheritance"),
    ("phenotype", "Inheritance"),
    ("mendel", "Inheritance"),
    ("punnett", "Inheritance"),
    ("linkage", "Inheritance"),
    ("crossing over", "Inheritance"),
    ("dominant", "Inheritance"),
    ("recessive", "Inheritance"),
    ("inheritance", "Inheritance"),
    ("variation", "Inheritance"),
    ("gene ", "Inheritance"),
    ("genes ", "Inheritance"),
    ("sex-linked", "Inheritance"),
    ("hemophilia", "Inheritance"),
    ("x-linked", "Inheritance"),
    ("independent assortment", "Inheritance"),
    ("chromosome", "Inheritance"),
    ("transcription", "Inheritance"),
    ("translation", "Inheritance"),
    ("replication", "Inheritance"),
    # --- circulation ---
    ("cardiac cycle", "Circulation"),
    ("heartbeat", "Circulation"),
    ("heart", "Circulation"),
    ("artery", "Circulation"),
    ("arteries", "Circulation"),
    ("vein", "Circulation"),
    ("capillar", "Circulation"),
    ("blood vessel", "Circulation"),
    ("lymph", "Circulation"),
    ("hemoglobin", "Circulation"),
    ("haemoglobin", "Circulation"),
    ("erythrocyte", "Circulation"),
    ("leukocyte", "Circulation"),
    ("platelet", "Circulation"),
    ("blood", "Circulation"),
    ("circulat", "Circulation"),
    # --- immunity ---
    ("immunit", "Immunity"),
    ("antibody", "Immunity"),
    ("antigen", "Immunity"),
    ("vaccine", "Immunity"),
    ("immune", "Immunity"),
    ("defense mechanism", "Immunity"),
    ("phagocyt", "Immunity"),
    ("lymphocyte", "Immunity"),
    ("t-cell", "Immunity"),
    ("b-cell", "Immunity"),
    # --- respiration ---
    ("respiratory system", "Respiration"),
    ("gaseous exchange", "Respiration"),
    ("gas exchange", "Respiration"),
    ("alveoli", "Respiration"),
    ("breathing", "Respiration"),
    ("trachea", "Respiration"),
    ("bronch", "Respiration"),
    ("diaphragm", "Respiration"),
    ("lung", "Respiration"),
    ("smoking", "Respiration"),
    ("inhal", "Respiration"),
    ("exhal", "Respiration"),
    # --- digestion ---
    ("digestive system", "Digestion"),
    ("digestion", "Digestion"),
    ("stomach", "Digestion"),
    ("intestin", "Digestion"),
    ("esophag", "Digestion"),
    ("oesophag", "Digestion"),
    ("pancrea", "Digestion"),
    ("liver", "Digestion"),
    ("bile", "Digestion"),
    ("nutrition", "Digestion"),
    ("alimentary", "Digestion"),
    ("peristalsis", "Digestion"),
    ("villi", "Digestion"),
    ("absorption", "Digestion"),
    ("stomata", "Digestion"),
    ("transpiration", "Digestion"),
    ("xylem", "Digestion"),
    ("phloem", "Digestion"),
    # --- evolution ---
    ("natural selection", "Evolution"),
    ("darwin", "Evolution"),
    ("lamarck", "Evolution"),
    ("speciation", "Evolution"),
    ("evolution", "Evolution"),
    ("fossil", "Evolution"),
    ("acquired character", "Evolution"),
    # --- biotechnology ---
    ("recombinant", "Biotechnology"),
    ("biotechnolog", "Biotechnology"),
    ("gene therapy", "Biotechnology"),
    ("cloning", "Biotechnology"),
    ("pcr", "Biotechnology"),
    ("plasmid vector", "Biotechnology"),
    ("monoclonal", "Biotechnology"),
    ("dna probe", "Biotechnology"),
    ("rna probe", "Biotechnology"),
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


# Map non-canonical / legacy chapter names to MDCAT canonical form
CHAPTER_NORMALIZATION: dict[str, str] = {
    "biology": None,
    "cell biology": "Cell Structure and Function",
    "cell cycle": "Cell Structure and Function",
    "biomolecules": "Biological Molecules",
    "molecular biology": "Biological Molecules",
    "genetics": "Inheritance",
    "variation and genetics": "Inheritance",
    "chromosome and dna": "Inheritance",
    "prokaryotes": "Cell Structure and Function",
    "growth and development": "Reproduction",
    # These combined / biodiversity buckets are re-split per question by the
    # keyword classifier in scripts.retag_biology_chapters; None = keep name if
    # the classifier can't place an individual MCQ.
    "circulation and immunity": None,  # split -> Circulation / Immunity
    "life processes (nutrition & gaseous exchange)": None,  # -> Digestion / Respiration
    "protists and fungi": None,
    "diversity among plants": None,
    "diversity among animals": None,
    "man and his environment": None,
}

_CANONICAL_NAMES = {ch["name"] for ch in BIOLOGY_CHAPTERS}


def normalize_chapter(name: str) -> str:
    """Fix non-canonical chapter names to their canonical form."""
    if not name or name in _CANONICAL_NAMES:
        return name
    mapped = CHAPTER_NORMALIZATION.get(name.lower().strip())
    if mapped:
        return mapped
    return name


def is_mdcat_chapter(name: str) -> bool:
    """Check if a chapter name is part of the official MDCAT syllabus."""
    return name in _CANONICAL_NAMES


def classify_question_chapter(
    question_text: str,
    options: list[dict] | None = None,
    fallback: str = "Biology",
) -> str:
    """Classify a single MCQ into its chapter using keyword matching.

    Combines question text + option texts for maximum keyword coverage.
    """
    parts = [question_text or ""]
    for opt in options or []:
        parts.append(str(opt.get("text", "")))
    combined = " ".join(parts)

    chapter = infer_chapter_from_text(combined)
    return chapter or fallback


def list_chapters() -> list[dict[str, str]]:
    return list(BIOLOGY_CHAPTERS)
