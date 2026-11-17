"""Supplier shorthand -> canonical fibre names.

Spec section 4.2. Care labels use inconsistent abbreviations; the codebook that
ships with FabricsCompositionDataset (``fiber_codebook.csv``) exists precisely to
normalise them. The table below seeds the common cases -- extend it from that CSV
once the dataset is downloaded.
"""

from __future__ import annotations

import unicodedata

# Canonical names match services.vision.taxonomy.FIBRE_CLASSES where one exists.
_CODEBOOK: dict[str, str] = {
    "co": "cotton",
    "cot": "cotton",
    "cotton": "cotton",
    "pes": "polyester",
    "pl": "polyester",
    "poly": "polyester",
    "polyester": "polyester",
    "pa": "nylon",  # ISO 2076: PA is polyamide; acrylic is PAN
    "acrylic": "acrylic",
    "pan": "acrylic",
    "ny": "nylon",
    "nylon": "nylon",
    "polyamide": "nylon",
    "pad": "nylon",
    "ea": "elastane_spandex",
    "el": "elastane_spandex",
    "lycra": "elastane_spandex",
    "spandex": "elastane_spandex",
    "elastane": "elastane_spandex",
    "elastan": "elastane_spandex",
    "elasthane": "elastane_spandex",
    # Urdu-script fibre names; fluent reader must confirm these spellings.
    "کاٹن": "cotton",
    "کپاس": "cotton",
    "پالیسٹر": "polyester",
    "پالئیسٹر": "polyester",
    "ریشم": "silk",
    "اون": "wool",
    "نائلون": "nylon",
    "ایلاسٹین": "elastane_spandex",
    "اسپینڈیکس": "elastane_spandex",
    "ویسکوز": "viscose_rayon",
    "ایکریلک": "acrylic",
    "wo": "wool",
    "wool": "wool",
    "wv": "wool",
    "virgin wool": "wool",
    "se": "silk",
    "silk": "silk",
    "li": "flax_linen",
    "lin": "flax_linen",
    "linen": "flax_linen",
    "flax": "flax_linen",
    "cv": "viscose_rayon",
    "vi": "viscose_rayon",
    "viscose": "viscose_rayon",
    "rayon": "viscose_rayon",
    "cmd": "modal",
    "modal": "modal",
    "cly": "lyocell",
    "lyocell": "lyocell",
    "tencel": "lyocell",
    "cuf": "cupro",
    "cupro": "cupro",
    "wm": "mohair",
    "mohair": "mohair",
    "was": "cashmere",
    "cashmere": "cashmere",
    "wp": "alpaca",
    "alpaca": "alpaca",
    "wa": "angora",
    "angora": "angora",
    "ha": "hemp",
    "hemp": "hemp",
    "ju": "jute",
    "jute": "jute",
    "ra": "ramie",
    "ramie": "ramie",
    "leather": "leather",
    "suede": "suede",
    # Common label languages (FR, DE, ES, IT, NL, PT). Keys are accent-folded.
    "coton": "cotton",
    "baumwolle": "cotton",
    "algodon": "cotton",
    "cotone": "cotton",
    "katoen": "cotton",
    "poliester": "polyester",
    "poliestere": "polyester",
    "elasthanne": "elastane_spandex",
    "elastano": "elastane_spandex",
    "elasthan": "elastane_spandex",
    "laine": "wool",
    "wolle": "wool",
    "lana": "wool",
    "soie": "silk",
    "seide": "silk",
    "seta": "silk",
    "seda": "silk",
    "leinen": "flax_linen",
    "lino": "flax_linen",
    "linho": "flax_linen",
    "viscosa": "viscose_rayon",
    "viskose": "viscose_rayon",
    "poliamida": "nylon",
    "poliammide": "nylon",
    "polyamid": "nylon",
    "acrilico": "acrylic",
    "acrylique": "acrylic",
    "polyacryl": "acrylic",
}


def fold_text(text: str) -> str:
    """Strip accents while preserving non-Latin scripts, and expand ß."""
    text = text.replace("ß", "ss").replace("ẞ", "SS")
    out = []
    for char in unicodedata.normalize("NFKC", text):
        if "LATIN" in unicodedata.name(char, ""):
            out.extend(
                part
                for part in unicodedata.normalize("NFKD", char)
                if not unicodedata.combining(part)
            )
        elif not unicodedata.combining(char):
            out.append(char)
    return "".join(out)


def normalize_fiber_name(raw: str) -> str | None:
    """Canonical fibre name, or ``None`` if unrecognised.

    ``None`` means *we do not know*, and callers must treat it as unreadable
    rather than dropping the component -- silently discarding an unknown fibre
    would let percentages sum to 100 and produce a confident wrong composition.
    """
    key = " ".join(fold_text(raw).strip().lower().replace(".", " ").split())
    if not key:
        return None
    return _CODEBOOK.get(key)


def known_aliases() -> frozenset[str]:
    return frozenset(_CODEBOOK)
