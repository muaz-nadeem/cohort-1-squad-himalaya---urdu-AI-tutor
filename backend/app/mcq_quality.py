"""Detect off-syllabus MCQs and parse a verified answer key from explanations.

Academy PDFs mix Biology with Physics. The live app is Biology-only, so these
helpers keep non-Biology items out of practice and recover swapped answer keys
that OCR/ingest attached to the wrong letter.
"""
from __future__ import annotations

import json
import re
from typing import Any, Optional

# Quarantined rows keep this chapter so sampling / chapter counts skip them.
EXCLUDED_CHAPTER = "__excluded_non_biology"

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
        current\s+through\s+(?:a\s+)?(?:resistor|wire|circuit)
    )\b
    """,
    re.IGNORECASE | re.VERBOSE,
)

_PHYSICS_SOURCE_RE = re.compile(r"\bphysic", re.IGNORECASE)


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


def is_excluded_chapter(chapter: Optional[str]) -> bool:
    name = (chapter or "").strip()
    return name == EXCLUDED_CHAPTER or name.startswith("__excluded")


def is_non_biology(row: dict[str, Any]) -> bool:
    """True when this MCQ is Physics (or already quarantined)."""
    if is_excluded_chapter(row.get("chapter")):
        return True
    source = str(row.get("source") or "")
    if _PHYSICS_SOURCE_RE.search(source):
        return True
    return bool(_PHYSICS_RE.search(question_blob(row)))


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
