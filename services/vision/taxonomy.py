"""Label spaces for the vision heads, and the mappings that derive them.

Spec: docs/superpowers/specs/2026-09-20-fabric-verification-scanner-design.md sections 4.1, 2.

The fibre-family collapse is the reason this module exists. TextileNet's 33-class
fibre partition tops out at 53.3% top-1, because members of a family are not
visually separable (cotton / modal / viscose / lyocell are all cellulose). The
families themselves *are* separable, so we predict those instead and never claim
exact fibre from an image.
"""

from __future__ import annotations

# TextileNet fabric partition -- Head A. Published ViT baseline: 67.3% top-1.
FABRIC_CLASSES: tuple[str, ...] = (
    "canvas",
    "chambray",
    "chenille",
    "chiffon",
    "corduroy",
    "crepe",
    "denim",
    "faux_fur",
    "faux_leather",
    "flannel",
    "fleece",
    "gingham",
    "jersey",
    "knit",
    "lace",
    "lawn",
    "neoprene",
    "organza",
    "plush",
    "satin",
    "serge",
    "taffeta",
    "tulle",
    "tweed",
    "twill",
    "velvet",
    "vinyl",
)

# TextileNet fibre partition -- collapsed into FIBRE_FAMILIES for Head C.
FIBRE_CLASSES: tuple[str, ...] = (
    "abaca",
    "acrylic",
    "alpaca",
    "angora",
    "aramid",
    "camel",
    "cashmere",
    "cotton",
    "cupro",
    "elastane_spandex",
    "flax_linen",
    "fur",
    "hemp",
    "horse_hair",
    "jute",
    "leather",
    "llama",
    "lyocell",
    "milk_fiber",
    "modal",
    "mohair",
    "nylon",
    "polyester",
    "polyolefin",
    "ramie",
    "silk",
    "sisal",
    "soybean_fiber",
    "suede",
    "triacetate_acetate",
    "viscose_rayon",
    "wool",
    "yak",
)

FIBRE_FAMILIES: tuple[str, ...] = ("cellulosic", "protein", "synthetic", "blend")

# Head B. Surface treatment.
TREATMENT_CLASSES: tuple[str, ...] = ("printed", "piece_dyed", "yarn_dyed", "undyed")

#: Every TextileNet fibre class -> its family. Exhaustive; asserted below.
#:
#: ``milk_fiber`` and ``soybean_fiber`` are regenerated protein (azlon) fibres.
#: ``fur``/``leather``/``suede`` are hides, not spun fibres -- chemically protein
#: (keratin/collagen) but structurally unlike wool, so evaluation reports their
#: per-class performance separately rather than hiding it in a family average.
FIBRE_TO_FAMILY: dict[str, str] = {
    # cellulosic
    "cotton": "cellulosic",
    "flax_linen": "cellulosic",
    "hemp": "cellulosic",
    "jute": "cellulosic",
    "ramie": "cellulosic",
    "abaca": "cellulosic",
    "sisal": "cellulosic",
    "viscose_rayon": "cellulosic",
    "modal": "cellulosic",
    "lyocell": "cellulosic",
    "cupro": "cellulosic",
    "triacetate_acetate": "cellulosic",
    # protein
    "wool": "protein",
    "silk": "protein",
    "cashmere": "protein",
    "mohair": "protein",
    "alpaca": "protein",
    "angora": "protein",
    "camel": "protein",
    "yak": "protein",
    "llama": "protein",
    "horse_hair": "protein",
    "fur": "protein",
    "leather": "protein",
    "suede": "protein",
    "milk_fiber": "protein",
    "soybean_fiber": "protein",
    # synthetic
    "polyester": "synthetic",
    "nylon": "synthetic",
    "acrylic": "synthetic",
    "elastane_spandex": "synthetic",
    "polyolefin": "synthetic",
    "aramid": "synthetic",
}

#: Structurally unlike the rest of their family. Reported separately (spec 4.1).
NON_SPUN_FIBRES: frozenset[str] = frozenset({"fur", "leather", "suede"})

#: Fabric classes whose treatment is fixed by definition -- free weak labels for
#: Head B (spec 4.1). Gingham and chambray *are* yarn-dyed; that is what the words
#: mean. Everything not listed here needs hand-labelling.
WEAK_TREATMENT_LABELS: dict[str, str] = {
    "gingham": "yarn_dyed",
    "chambray": "yarn_dyed",
    "denim": "yarn_dyed",
    "lace": "piece_dyed",
    "tulle": "piece_dyed",
    "organza": "piece_dyed",
}


def family_of(fibre: str) -> str:
    """Family for a TextileNet fibre class. Raises KeyError on unknown input."""
    return FIBRE_TO_FAMILY[fibre]


def _validate() -> None:
    missing = set(FIBRE_CLASSES) - set(FIBRE_TO_FAMILY)
    if missing:
        raise AssertionError(f"fibre classes with no family: {sorted(missing)}")
    unknown = set(FIBRE_TO_FAMILY) - set(FIBRE_CLASSES)
    if unknown:
        raise AssertionError(f"family map has non-TextileNet classes: {sorted(unknown)}")
    bad = {f for f in FIBRE_TO_FAMILY.values() if f not in FIBRE_FAMILIES}
    if bad:
        raise AssertionError(f"unknown families: {sorted(bad)}")
    bad_weak = set(WEAK_TREATMENT_LABELS) - set(FABRIC_CLASSES)
    if bad_weak:
        raise AssertionError(f"weak labels for unknown fabrics: {sorted(bad_weak)}")


_validate()
