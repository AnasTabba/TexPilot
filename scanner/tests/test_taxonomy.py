"""The fibre-family collapse is the project's central honesty claim. Guard it."""

from services.vision import taxonomy as tx


def test_every_fibre_class_maps_to_a_family():
    assert set(tx.FIBRE_CLASSES) == set(tx.FIBRE_TO_FAMILY)


def test_all_families_are_known():
    assert set(tx.FIBRE_TO_FAMILY.values()) <= set(tx.FIBRE_FAMILIES)


def test_class_counts_match_textilenet():
    assert len(tx.FABRIC_CLASSES) == 27
    assert len(tx.FIBRE_CLASSES) == 33


def test_regenerated_protein_fibres_are_protein():
    assert tx.family_of("milk_fiber") == "protein"
    assert tx.family_of("soybean_fiber") == "protein"


def test_cellulosics_that_look_identical_share_a_family():
    # The whole reason we predict families: these are indistinguishable in a photo.
    assert {tx.family_of(f) for f in ("cotton", "modal", "viscose_rayon", "lyocell")} == {
        "cellulosic"
    }


def test_weak_treatment_labels_reference_real_fabrics():
    assert set(tx.WEAK_TREATMENT_LABELS) <= set(tx.FABRIC_CLASSES)
    assert set(tx.WEAK_TREATMENT_LABELS.values()) <= set(tx.TREATMENT_CLASSES)
