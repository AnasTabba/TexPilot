"""Supplier shorthand -> canonical fibre names.

Spec section 4.2. Care labels use inconsistent abbreviations; the codebook that
ships with FabricsCompositionDataset (``fiber_codebook.csv``) exists precisely to
normalise them. The table below seeds the common cases -- extend it from that CSV
once the dataset is downloaded.
"""

from __future__ import annotations

# Canonical names match services.vision.taxonomy.FIBRE_CLASSES where one exists.
_CODEBOOK: dict[str, str] = {
    "co": "cotton",
    "cot": "cotton",
    "cotton": "cotton",
    "pes": "polyester",
    "pl": "polyester",
    "poly": "polyester",
    "polyester": "polyester",
    "pa": "acrylic",
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
}


def normalize_fiber_name(raw: str) -> str | None:
    """Canonical fibre name, or ``None`` if unrecognised.

    ``None`` means *we do not know*, and callers must treat it as unreadable
    rather than dropping the component -- silently discarding an unknown fibre
    would let percentages sum to 100 and produce a confident wrong composition.
    """
    key = " ".join(raw.strip().lower().replace(".", " ").split())
    if not key:
        return None
    return _CODEBOOK.get(key)


def known_aliases() -> frozenset[str]:
    return frozenset(_CODEBOOK)
