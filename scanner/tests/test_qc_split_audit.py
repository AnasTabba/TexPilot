"""Synthetic records below are test doubles, never collected dataset evidence."""

import json
from dataclasses import asdict

import pytest

from training.qc.manifest import DatasetManifest, ManifestItem, SourceRecord, classify_mask
from training.qc.split_audit import audit_splits


def hash_double(value):
    import hashlib

    return hashlib.sha256(value.encode()).hexdigest()


def item_double(name="image-double", **changes):
    values = dict(
        id=name,
        source="AITEX",
        image_sha256=hash_double(name),
        split="train",
        image_label="defective",
        mask_category="valid-defective",
        mask_sha256=hash_double(name + "mask"),
        roll_id=name + "roll",
        lot_id=name + "lot",
    )
    return ManifestItem(**(values | changes))


def manifest_double(*items, sources=None):
    return DatasetManifest(
        "manifest-double",
        "1",
        "research",
        sources
        or tuple(
            SourceRecord(s, "double", "local:test-double", "test-only-rights", ("research",))
            for s in sorted({i.source for i in items})
        ),
        tuple(items),
    )


@pytest.mark.parametrize(
    "link", ["parent_id", "roll_id", "lot_id", "image_sha256", "perceptual_hash"]
)
@pytest.mark.parametrize("other_split", ["validation", "calibration", "release_test"])
def test_connected_groups_never_span_splits(link, other_split):
    shared = hash_double("same") if link == "image_sha256" else "0000000000000000"
    a = item_double("a", **{link: shared})
    b = item_double("b", split=other_split, **{link: shared})
    report = audit_splits(manifest_double(a, b))
    assert "GROUP_SPANS_SPLITS" in report.codes()
    assert not report.promotable
    assert not report.confirmatory_release_eligible


def test_transitive_parent_roll_lot_and_near_duplicate_components():
    items = (
        item_double("a"),
        item_double("b", parent_id="a", roll_id="r"),
        item_double("c", roll_id="r", lot_id="l"),
        item_double("d", lot_id="l", perceptual_hash="0000000000000000"),
        item_double("e", perceptual_hash="0000000000000001", split="calibration"),
    )
    report = audit_splits(manifest_double(*items))
    assert report.components == (("a", "b", "c", "d", "e"),)
    assert not report.promotable


@pytest.mark.parametrize("source", ["MVTec", "WFDD", "AITEX"])
def test_adnet_cross_source_overlap_is_contaminated_and_not_confirmatory(source):
    report = audit_splits(
        manifest_double(
            item_double("a", source="ADNet"),
            item_double("b", source=source, image_sha256=hash_double("a"), split="release_test"),
        )
    )
    assert "CROSS_SOURCE_OVERLAP_IN_TEST" in report.codes()
    assert report.benchmark_status == "CONTAMINATED_EXPLORATORY"
    assert not report.promotable
    assert not report.confirmatory_release_eligible


def test_declared_compilation_overlap_without_matching_hashes_blocks_test():
    sources = (
        SourceRecord(
            "ADNet",
            "double",
            "local:double",
            "test-only-rights",
            ("research",),
            derived_from=("AITEX",),
        ),
        SourceRecord("AITEX", "double", "local:double", "test-only-rights", ("research",)),
    )
    report = audit_splits(
        manifest_double(
            item_double("a", source="ADNet"),
            item_double("b", split="release_test"),
            sources=sources,
        )
    )
    assert not report.promotable
    assert report.benchmark_status == "CONTAMINATED_EXPLORATORY"


@pytest.mark.parametrize("license", [None, "", "unknown", "not yet collected"])
def test_unknown_license_blocks_promotion(license):
    source = SourceRecord("AITEX", "double", "local:double", license, ("research",))
    assert not audit_splits(manifest_double(item_double(), sources=(source,))).promotable


def empty_mask_double():
    return item_double(
        "empty-double", mask_category="empty-defective", split="release_test", cohort="CONFIRMATORY"
    )


def test_aitex_empty_mask_stays_image_level_defective():
    item = empty_mask_double()
    report = audit_splits(manifest_double(item))
    assert item.image_label == "defective"
    assert report.image_level_eligible == (item.id,)


def test_aitex_empty_mask_is_pixel_ineligible():
    report = audit_splits(manifest_double(empty_mask_double()))
    assert not report.pixel_eligible
    assert report.pixel_excluded == {"empty-defective": 1}


def test_aitex_empty_mask_is_excluded_confirmatory_release():
    report = audit_splits(manifest_double(empty_mask_double()))
    assert not report.confirmatory_release_eligible
    assert not report.promotable


def test_aitex_empty_mask_never_relabelled_normal():
    manifest = manifest_double(empty_mask_double())
    before = asdict(manifest)
    audit_splits(manifest)
    assert asdict(manifest) == before
    assert manifest.items[0].image_label != "normal"


def test_aitex_empty_mask_never_dropped():
    item = empty_mask_double()
    report = audit_splits(manifest_double(item))
    assert report.unresolved_empty_defective == (item.id,)
    assert sum(report.mask_counts.values()) == 1


def test_aitex_empty_mask_never_given_invented_mask():
    item = empty_mask_double()
    audit_splits(manifest_double(item))
    assert item.mask_sha256 == hash_double(item.id + "mask")
    assert item.derived_mask_sha256 is None
    assert item.mask_source_sha256s == ()


def test_aitex_empty_mask_report_says_g5_open():
    report = audit_splits(manifest_double(empty_mask_double()))
    assert "G5" in report.open_gates
    assert any("G5" in f.message and "open" in f.message.lower() for f in report.findings)


@pytest.mark.parametrize(
    "case,expected",
    [
        ({"mask_present": False}, "absent"),
        ({"mask_present": True}, "empty-defective"),
        ({"mask_present": True, "defect_pixels": 3}, "valid-defective"),
        ({"mask_present": True, "readable": False}, "corrupt"),
        ({"mask_present": True, "shape_matches": False}, "corrupt"),
        ({"mask_present": True, "orientation_matches": False}, "corrupt"),
        (
            {"mask_present": True, "shape_matches": False, "adjudicated_sources": ("source",)},
            "corrupt",
        ),
    ],
)
def test_mask_classification_never_repairs_shape_or_orientation(case, expected):
    assert classify_mask("defective", **case) == expected


def test_absent_is_distinct_from_explicit_clean_mask():
    assert classify_mask("normal", mask_present=False) == "absent"
    assert classify_mask("normal", mask_present=True) == "valid-clean"


def test_categories_lineage_and_exclusion_counts_serialize():
    categories = (
        "absent",
        "empty-defective",
        "valid-clean",
        "valid-defective",
        "corrupt",
        "adjudicated-derived",
    )
    items = [
        item_double(
            str(n),
            mask_category=c,
            image_label="normal" if c == "valid-clean" else "defective",
            mask_sha256=None if c == "absent" else hash_double(c),
            derived_mask_sha256=hash_double("union") if c == "adjudicated-derived" else None,
            mask_source_sha256s=(hash_double(c), hash_double("mask1"), hash_double("mask2"))
            if c == "adjudicated-derived"
            else (),
        )
        for n, c in enumerate(categories)
    ]
    report = audit_splits(manifest_double(*items))
    serialized = json.loads(json.dumps(asdict(report)))
    assert serialized["mask_counts"] == dict.fromkeys(categories, 1)
    assert sum(serialized["pixel_excluded"].values()) == 3
    assert sum(serialized["image_excluded"].values()) == 0
    union = serialized["mask_records"][-1]
    assert union["raw_sha256"] == hash_double("adjudicated-derived")
    assert union["derived_sha256"] == hash_double("union")
    assert union["source_sha256s"] == [
        hash_double("adjudicated-derived"),
        hash_double("mask1"),
        hash_double("mask2"),
    ]


def test_malformed_lineage_is_not_pixel_truth():
    item = item_double(
        mask_category="adjudicated-derived", derived_mask_sha256="bad", mask_source_sha256s=("bad",)
    )
    report = audit_splits(manifest_double(item))
    assert not report.promotable
    assert not report.pixel_eligible


def confirmatory_double(name="a", **changes):
    return item_double(
        name,
        **(
            dict(
                source="lab-source-double",
                split="release_test",
                cohort="CONFIRMATORY",
                selection_id="selection-double",
                plan_sha256=hash_double("plan"),
                face="face",
                location_ref="location-double",
                selection_probability=0.25,
                factory_id="factory-double",
                roll_id="roll-double",
                lot_id="lot-double",
                supplier_id="supplier-double",
                planned_area_cm2=100.0,
                usable_area_cm2=80.0,
                sampling_method="random-double",
            )
            | changes
        ),
    )


def test_repeat_photos_are_one_submitted_selection_unit():
    report = audit_splits(manifest_double(confirmatory_double(), confirmatory_double("b")))
    assert report.submitted_selection_units == 1
    assert report.confirmatory_selection_units == 1
    assert report.promotable  # one selection remains one unit, despite multiple photos


@pytest.mark.parametrize(
    "field,value",
    [
        ("plan_sha256", None),
        ("roll_id", None),
        ("face", "unknown"),
        ("selection_probability", None),
        ("factory_id", None),
    ],
)
def test_unknown_selection_plan_roll_face_or_probability_fails(field, value):
    report = audit_splits(manifest_double(confirmatory_double(**{field: value})))
    assert "SELECTION_INVALID" in report.codes()
    assert not report.confirmatory_release_eligible


def test_challenge_selection_cannot_be_laundered_through_another_photo():
    report = audit_splits(
        manifest_double(confirmatory_double(cohort="CHALLENGE"), confirmatory_double("b"))
    )
    assert "CHALLENGE_IN_CONFIRMATORY" in report.codes()
    assert not report.confirmatory_release_eligible


@pytest.mark.parametrize("label", ["unknown", "uncertain", "", None])
def test_unknown_image_label_cannot_be_eligible_truth(label):
    report = audit_splits(manifest_double(item_double(image_label=label)))
    assert not report.image_level_eligible
    assert not report.pixel_eligible
    assert not report.promotable


def test_repeat_photos_join_same_selection_even_without_shared_hashes_or_rolls():
    report = audit_splits(
        manifest_double(
            item_double("a", selection_id="selection-double"),
            item_double("b", selection_id="selection-double", split="calibration"),
        )
    )
    assert "GROUP_SPANS_SPLITS" in report.codes()


def test_all_aitex_confirmatory_results_blocked_while_empty_mask_policy_is_open():
    report = audit_splits(manifest_double(confirmatory_double(source="AITEX")))
    assert "G5" in report.open_gates
    assert not report.promotable
    assert not report.confirmatory_release_eligible


@pytest.mark.parametrize("threshold", [-1, 65, True, 1.5])
def test_invalid_dedup_threshold_rejected(threshold):
    with pytest.raises(ValueError):
        audit_splits(manifest_double(item_double()), near_duplicate_bits=threshold)


@pytest.mark.parametrize("roll", ["unknown", "not yet collected", ""])
def test_placeholder_roll_is_unknown(roll):
    report = audit_splits(manifest_double(confirmatory_double(roll_id=roll)))
    assert not report.promotable
    assert not report.confirmatory_release_eligible


@pytest.mark.parametrize(
    "changes",
    [
        {"planned_area_cm2": None},
        {"planned_area_cm2": 0},
        {"usable_area_cm2": None, "area_missingness_reason": None},
        {"usable_area_cm2": 101},
        {"usable_area_cm2": -1},
        {"supplier_id": None},
        {"sampling_method": None},
    ],
)
def test_confirmatory_area_missingness_and_factory_sampling_binding_are_explicit(changes):
    report = audit_splits(manifest_double(confirmatory_double(**changes)))
    assert not report.promotable
    assert not report.confirmatory_release_eligible


@pytest.mark.parametrize("link", ["roll_id", "lot_id", "parent_id", "selection_id"])
def test_identifier_case_and_padding_cannot_split_one_physical_group(link):
    a = item_double("a", **{link: "Roll-7"})
    b = item_double("b", split="release_test", **{link: " roll-7 "})
    assert "GROUP_SPANS_SPLITS" in audit_splits(manifest_double(a, b)).codes()
