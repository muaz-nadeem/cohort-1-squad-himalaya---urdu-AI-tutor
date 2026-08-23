"""Detect off-syllabus MCQs and parse a verified answer key from explanations.

Academy PDFs mix Biology with Physics and Chemistry. The live app is Biology-only,
so these helpers keep non-Biology items out of practice and recover swapped answer
keys that OCR/ingest attached to the wrong letter.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

# Quarantined rows keep this chapter so sampling / chapter counts skip them.
EXCLUDED_CHAPTER = "__excluded_non_biology"

# LLM-flagged Physics IDs that never stuck in Supabase (anon key cannot UPDATE).
# Counts and sampling still skip these so the bank numbers stay Biology-only.
_EXCLUDED_IDS_PATH = (
    Path(__file__).resolve().parents[1] / "data" / "excluded_non_biology_ids.txt"
)

_KEY_LINE = re.compile(r"^KEY:\s*([A-D])\b", re.IGNORECASE)

# Strong Physics markers. Keep conservative so Biology (lens of the eye,
# blood pressure, nerve impulse, osmotic pressure) is not swept out.
_PHYSICS_RE = re.compile(
    r"""
    \b(?:
        newton(?:'?s)?(?:\s+law)? |
        pascal'?s\s+law |
        kirchhoff |
        wheatstone |
        coulomb(?:'?s)? |
        farad(?:s)? |
        tesla(?:s)? |
        weber(?:s)? |
        henry(?:s)?\b |
        joule(?:'?s)?\s+law |
        ohm(?:'?s)?(?:\s+law)? |
        snell(?:'?s)? |
        de\s*broglie |
        photoelectric |
        work\s+function |
        planck(?:'?s)? |
        simple\s+harmonic |
        moment\s+of\s+inertia |
        centripetal |
        projectile(?:\s+motion)? |
        kinematics? |
        angular\s+momentum |
        magnetic\s+flux |
        electric\s+field\s+intensity |
        potential\s+difference |
        ammeter |
        voltmeter |
        galvanometer |
        capacitor(?:s)? |
        inductor(?:s)? |
        solenoid |
        transformer |
        convex\s+lens |
        concave\s+(?:lens|mirror) |
        young'?s\s+(?:double|modulus) |
        refractive\s+index |
        critical\s+angle |
        diffraction |
        interference\s+fringe |
        wavelength\s+of\s+(?:a\s+)?(?:photon|electron|x-?ray) |
        si\s+unit\s+of\s+(?:force|charge|current|potential|resistance|power) |
        a\s+body\s+of\s+mass |
        an\s+object\s+(?:is\s+)?(?:thrown|projected|dropped) |
        resistance\s+of\s+(?:a\s+)?wire |
        current\s+through\s+(?:a\s+)?(?:resistor|wire|circuit) |
        magnetic\s+field |
        electric\s+charge |
        focal\s+length\s+of\s+(?:a\s+)?(?:lens|mirror|convex|concave) |
        image\s+distance |
        object\s+distance |
        \bf\s*=\s*ma\b |
        \be\s*=\s*mc\s*\^?\s*2\b |
        nuclear\s+(?:fission|fusion|reactor) |
        semiconductor |
        photon\s+energy |
        parallel\s+wires |
        (?:half|full)[\s-]+wave\s+rectifier |
        permanent\s+magnet |
        laser\s+light |
        direct\s+current |
        alternating\s+current |
        time\s+of\s+flight |
        sound\s+waves? |
        decay\s+constant |
        kinetic\s+energ |
        work\s+done |
        momentum\s+of\s+(?:a\s+)?photon |
        acceleration\s+of\s+(?:the\s+)?(?:car|body|object|particle) |
        (?:masses?|bodies)\s+.*\s+dropped\s+from |
        \d+\s*V\s+to\s+\d+\s*V |
        \d+\s*ohm |
        \d+\s*volts? |
        product\s+of\s+P\s+and\s+V |
        ideal\s+gas |
        boyle(?:'?s)?\s+law |
        charles(?:'?s)?\s+law |
        angular\s+velocity |
        circular\s+motion |
        uniform\s+circular |
        PN\s+junction |
        centre\s+of\s+gravity |
        center\s+of\s+gravity |
        equivalent\s+resistance |
        stopping\s+potential |
        radioactive\s+nucleus |
        potential\s+difference |
        linear\s+velocity\s+of\s+a\s+body\s+moving\s+in\s+a\s+circle
    )\b
    """,
    re.IGNORECASE | re.VERBOSE,
)

_PHYSICS_SOURCE_RE = re.compile(r"\bphysic", re.IGNORECASE)

# Strong Chemistry markers. Keep conservative so Biology (pH, enzymes, ATP,
# oxidation in respiration, isotopes in medicine) is not swept out.
_CHEMISTRY_RE = re.compile(
    r"""
    \b(?:
        avogadro(?:'?s)? |
        molar(?:ity|mass)? |
        molality |
        mole\s+(?:ratio|concept|fraction) |
        stoichiometr |
        empirical\s+formula |
        molecular\s+formula |
        lewis\s+structure |
        hybridization |
        sp3|sp2|sp\s*hybrid |
        benzene |
        alkane|alkene|alkyne |
        functional\s+group |
        iupac |
        carboxylic\s+acid |
        esterification |
        saponification |
        titration |
        equivalence\s+point |
        normality |
        galvanic\s+cell |
        electrolytic\s+cell |
        electrolysis |
        nernst |
        oxidation\s+(?:number|state) |
        redox\s+(?:reaction|equation) |
        ionization\s+energy |
        electron\s+affinity |
        electronegativity |
        periodic\s+(?:table|law|trend) |
        chemical\s+equilibrium |
        rate\s+law |
        order\s+of\s+reaction |
        organic\s+compound |
        inorganic\s+compound |
        valency |
        covalent\s+bond |
        ionic\s+bond |
        metallic\s+bond |
        mole\s+of |
        grams?\s+to\s+moles? |
        molar\s+volume |
        standard\s+molar |
        buffer\s+solution |
        acid\s+base\s+titration |
        pH\s+of\s+(?:a\s+)?(?:solution|HCl|NaOH|acid|base) |
        chemical\s+kinetics |
        activation\s+energy\s+of\s+(?:a\s+)?reaction |
        catalyst\s+(?:speeds|increases\s+rate\s+of\s+(?:a\s+)?chemical)
    )\b
    """,
    re.IGNORECASE | re.VERBOSE,
)

_CHEMISTRY_SOURCE_RE = re.compile(r"\bchem(?:istry|ical)?\b", re.IGNORECASE)

# If the stem is clearly Biology, never drop the MCQ based on option wording alone
# (e.g. synapse MCQs may mention electric current / potential difference).
_BIOLOGY_STEM_RE = re.compile(
    r"\b(?:"
    r"cell|cells|dna|rna|enzyme|organism|plant|animal|heart|kidney|liver|"
    r"lung|lungs|pleural|alveol|trachea|bronch|diaphragm|chest\s+cavity|"
    r"neuron|synapse|mitosis|meiosis|photosynthesis|hormone|bacteria|virus|"
    r"tissue|organ|species|ecosystem|embryo|fertilization|chromosome|gene|"
    r"protein|membrane|macromolecule|carbohydrate|lipid|amino|nucleotide|"
    r"ATP|respiration|digestion|blood|muscle|bone|skin|leaf|root|stem|flower|"
    r"seed|pancreatic|insulin|glucose|antibody|immune|vaccine|inheritance|"
    r"sucrose|lactose|maltose|enzyme|hydrolysis|condensation|osmosis|diffusion|"
    r"homeostasis|excretion|reproduction|evolution|ecology|food\s+chain|"
    r"biomolecule|nucleus|cytoplasm|chloroplast|mitochondria|ribosome"
    r")\b",
    re.IGNORECASE,
)

# Broader option-level terms for when the stem is vague but all choices are Phy/Chem.
_OPTION_SUBJECT_RE = re.compile(
    r"\b(?:"
    r"force|work|power|energy|current|voltage|resistance|entropy|enthalpy|"
    r"capacitance|inductance|frequency|wavelength|amplitude|velocity|"
    r"acceleration|momentum|impulse|torque|pressure|density|conductivity|"
    r"resistivity|molarity|molality|normality|alkane|alkene|alkyne|benzene|"
    r"electron|proton|neutron|isotope|half[\s-]life|decay|fusion|fission|"
    r"photon|quantum|relativity|magnet|electric\s+field|potential\s+difference|"
    r"equivalent\s+resistance|PN\s+junction|diode|rectifier|transformer"
    r")\b",
    re.IGNORECASE,
)


def _options_text(options: Any) -> str:
    if isinstance(options, str):
        return options
    if not isinstance(options, list):
        return ""
    parts: list[str] = []
    for opt in options:
        if isinstance(opt, dict):
            parts.append(f"{opt.get('key', '')} {opt.get('text', '')}")
        else:
            parts.append(str(opt))
    return " ".join(parts)


def question_blob(row: dict[str, Any]) -> str:
    return " ".join(
        [
            str(row.get("question_text") or ""),
            _options_text(row.get("options")),
            str(row.get("explanation") or ""),
            str(row.get("source") or ""),
            str(row.get("chapter") or ""),
        ]
    )


def subject_blob(row: dict[str, Any]) -> str:
    """Text used to detect Physics/Chemistry — stem + source only.

    Options often list chemistry terms (e.g. esterification, molecular formula)
    as Biology distractors, so they must not drive subject classification.
    """
    return " ".join(
        [
            str(row.get("question_text") or ""),
            str(row.get("source") or ""),
        ]
    )


def is_excluded_chapter(chapter: Optional[str]) -> bool:
    name = (chapter or "").strip()
    return name == EXCLUDED_CHAPTER or name.startswith("__excluded")


@lru_cache(maxsize=1)
def excluded_question_ids() -> frozenset[str]:
    if not _EXCLUDED_IDS_PATH.exists():
        return frozenset()
    return frozenset(
        line.strip()
        for line in _EXCLUDED_IDS_PATH.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    )


def add_excluded_ids(question_ids: list[str]) -> int:
    """Append newly found Physics IDs to the local exclusion list."""
    existing = set(excluded_question_ids())
    new = [i for i in dict.fromkeys(question_ids) if i and i not in existing]
    if not new:
        return 0
    _EXCLUDED_IDS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _EXCLUDED_IDS_PATH.open("a", encoding="utf-8") as f:
        for qid in new:
            f.write(qid + "\n")
    excluded_question_ids.cache_clear()
    return len(new)


def _options_non_biology_hits(row: dict[str, Any]) -> int:
    """How many options look Physics/Chemistry (needs 2+ to classify the MCQ)."""
    opts = row.get("options")
    if not isinstance(opts, list):
        return 0
    hits = 0
    for opt in opts:
        text = opt.get("text", "") if isinstance(opt, dict) else str(opt)
        if (
            _PHYSICS_RE.search(text)
            or _CHEMISTRY_RE.search(text)
            or _OPTION_SUBJECT_RE.search(text)
        ):
            hits += 1
    return hits


def matches_non_biology_content(row: dict[str, Any]) -> bool:
    """Regex/source signal that a row is Physics or Chemistry (ignores ID blocklist)."""
    if is_excluded_chapter(row.get("chapter")):
        return True
    blob = subject_blob(row)
    source = str(row.get("source") or "")
    if _PHYSICS_SOURCE_RE.search(source) or _CHEMISTRY_SOURCE_RE.search(source):
        return True
    if _PHYSICS_RE.search(blob) or _CHEMISTRY_RE.search(blob):
        return True
    stem = str(row.get("question_text") or "")
    if _BIOLOGY_STEM_RE.search(stem):
        return False
    # Some stems are vague but every option is Physics/Chemistry (e.g. transformer MCQs).
    # Require 2+ option hits so a single bio distractor (esterification, molecular formula)
    # does not drop an otherwise Biology question.
    return _options_non_biology_hits(row) >= 2


def is_non_biology(row: dict[str, Any]) -> bool:
    """True when this MCQ is Physics, Chemistry, or already quarantined."""
    qid = str(row.get("id") or "").strip()
    if qid and qid in excluded_question_ids():
        return True
    return matches_non_biology_content(row)


def format_options(options: Any) -> str:
    if not isinstance(options, list):
        return ""
    lines = []
    for opt in options:
        if isinstance(opt, dict):
            lines.append(f"{opt.get('key', '?')}) {opt.get('text', '')}")
    return "\n".join(lines)


def parse_explain_key(text: str) -> tuple[Optional[str], str]:
    """Split a leading `KEY: B` line from an explanation."""
    raw = (text or "").strip()
    if not raw:
        return None, raw
    first, _, rest = raw.partition("\n")
    match = _KEY_LINE.match(first.strip())
    if not match:
        return None, raw
    return match.group(1).upper(), rest.strip()


def option_keys(row: dict[str, Any]) -> set[str]:
    keys: set[str] = set()
    opts = row.get("options")
    if isinstance(opts, list):
        for opt in opts:
            if isinstance(opt, dict):
                key = str(opt.get("key") or "").strip().upper()[:1]
                if key:
                    keys.add(key)
    return keys


def parse_audit_json(raw: str) -> Optional[dict[str, str]]:
    text = (raw or "").strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence:
        text = fence.group(1).strip()
    start, end = text.find("{"), text.rfind("}")
    if start >= 0 and end > start:
        text = text[start : end + 1]
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    key = str(data.get("correct_option") or "").strip().upper()[:1]
    subject = str(data.get("subject") or "").strip().lower()
    confidence = str(data.get("confidence") or "low").strip().lower()
    if key and key not in {"A", "B", "C", "D"}:
        key = ""
    if subject not in {"biology", "physics", "chemistry", "english", "other"}:
        subject = "other"
    if confidence not in {"high", "medium", "low"}:
        confidence = "low"
    return {
        "correct_option": key,
        "subject": subject,
        "confidence": confidence,
    }
