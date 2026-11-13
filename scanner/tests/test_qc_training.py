"""Synthetic boundary tests only: no trained model, dataset or hardware proof."""

import hashlib
import json
import subprocess
import sys
from dataclasses import asdict, replace
from pathlib import Path

import pytest

from services.api.qc_schemas import canonical_json, sha256_hex
from training.qc.evaluate import (
    Bundle,
    BundleUnavailable,
    evaluate_bundle,
    fabric_metrics,
    fault_denominators,
)
from training.qc.manifest import DatasetManifest, ManifestItem, SourceRecord
from training.qc.split_audit import audit_splits
from training.qc.train_manifest import (
    REQUIRED_RUN_FIELDS,
    ResumeRecord,
    TrainingInputError,
    fit_with_guard,
    independent_seed_count,
    validate_run_record,
)


def synthetic_hash(value):
    return hashlib.sha256(value.encode()).hexdigest()


@pytest.fixture
def synthetic_inputs(tmp_path):
    items, features, feature_files = [], {}, {}
    mask = tmp_path / "synthetic-clean-mask"
    mask.write_bytes(b"synthetic-clean-mask")
    for n, split in enumerate(("train", "validation", "calibration", "release_test")):
        name = f"synthetic-{split}"
        data = name.encode()
        (tmp_path / name).write_bytes(data)
        feature = tmp_path / f"{name}.feature"
        feature.write_bytes(data + b"-feature")
        items.append(
            ManifestItem(
                name,
                "synthetic",
                synthetic_hash(name),
                split,
                "normal",
                "valid-clean",
                mask_sha256=synthetic_hash("synthetic-clean-mask"),
                path=name,
                feature_sha256=synthetic_hash(name + "-feature"),
                lot_id=f"synthetic-lot-{n}",
                fabric_label="a",
                domain="synthetic-domain",
            )
        )
        if split in ("train", "validation"):
            features[name] = feature
        feature_files[items[-1].feature_sha256] = feature
    manifest = DatasetManifest(
        "synthetic-only",
        "1",
        "research",
        (
            SourceRecord(
                "synthetic", "1", "synthetic://generated", "synthetic-test-only", ("research",)
            ),
        ),
        tuple(items),
        {"taxonomy_version": "synthetic-fabric22", "label_universe": ["a", "b"]},
    )
    audit = audit_splits(manifest)
    kwargs = dict(
        expected_manifest_sha256=manifest.sha256(),
        expected_audit_sha256=sha256_hex(canonical_json(asdict(audit))),
        root=tmp_path,
        fit_ids=("synthetic-train",),
        validation_ids=("synthetic-validation",),
        tta_ids=("synthetic-validation",),
        test_export_ids=("synthetic-validation",),
        feature_cache=features,
        feature_files=feature_files,
        mask_files={synthetic_hash("synthetic-clean-mask"): mask},
    )
    return manifest, audit, kwargs


def test_synthetic_guard_verifies_before_construction_and_logs_all_consumers(synthetic_inputs):
    manifest, audit, kwargs = synthetic_inputs
    seen = []

    def synthetic_model_double():
        seen.append("constructed")
        return object()

    def synthetic_fit_double(model, log):
        assert model is not None
        seen.append(log.fit_ids)
        return "synthetic-result"

    result, log = fit_with_guard(
        synthetic_model_double, synthetic_fit_double, manifest, audit, **kwargs
    )
    assert result == "synthetic-result"
    assert seen == ["constructed", ("synthetic-train",)]
    assert log.audit_sha256 == kwargs["expected_audit_sha256"]
    assert log.files_verified == 4  # sealed files checked, never sent to a trainer
    assert log.features_verified == 2
    assert log.tta_ids == log.test_export_ids == ("synthetic-validation",)


@pytest.mark.parametrize(
    "damage",
    [
        "deleted",
        "changed",
        "sealed-deleted",
        "feature-changed",
        "feature-hash-only",
        "extra-release-cache",
        "legacy",
        "truncate",
        "fit-truncated",
        "validation-truncated",
        "audit-changed",
        "audit-stale",
        "manifest-hash",
        "duplicate-fit",
        "no-audit",
        "raw-mask",
        "derived-mask",
        "mask-source",
        "sealed-feature-changed",
    ],
)
def test_synthetic_damage_fails_before_any_model_construction(synthetic_inputs, damage):
    manifest, audit, kwargs = synthetic_inputs
    root = kwargs["root"]
    if damage == "deleted":
        (root / "synthetic-train").unlink()
    elif damage == "changed":
        (root / "synthetic-train").write_bytes(b"changed")
    elif damage == "sealed-deleted":
        (root / "synthetic-release_test").unlink()
    elif damage == "feature-changed":
        kwargs["feature_cache"]["synthetic-train"].write_bytes(b"changed-feature")
    elif damage == "sealed-feature-changed":
        (root / "synthetic-release_test.feature").write_bytes(b"changed-sealed-feature")
    elif damage == "feature-hash-only":
        kwargs["feature_cache"]["synthetic-train"] = manifest.items[0].feature_sha256
    elif damage == "extra-release-cache":
        kwargs["feature_cache"]["synthetic-release_test"] = root / "synthetic-release_test.feature"
    elif damage == "legacy":
        kwargs["input_sources"] = ("training/textilenet/splits/prelim/fabric.csv",)
    elif damage == "truncate":
        manifest = replace(manifest, items=manifest.items[:-1])
    elif damage == "fit-truncated":
        kwargs["fit_ids"] = ()
    elif damage == "validation-truncated":
        kwargs["validation_ids"] = ()
    elif damage == "audit-changed":
        audit = replace(audit, pixel_eligible=())
    elif damage == "audit-stale":
        audit = replace(audit, manifest_sha256="0" * 64)
    elif damage == "manifest-hash":
        kwargs["expected_manifest_sha256"] = "0" * 64
    elif damage == "duplicate-fit":
        kwargs["fit_ids"] *= 2
    elif damage == "no-audit":
        audit = None
    else:
        mask, derived_path, source_path = (
            root / name for name in ("synthetic-mask", "synthetic-derived", "synthetic-source")
        )
        for path in (mask, derived_path, source_path):
            path.write_text(path.name)
        raw = synthetic_hash("synthetic-mask")
        derived, source = synthetic_hash("synthetic-derived"), synthetic_hash("synthetic-source")
        item = replace(
            manifest.items[0],
            mask_sha256=raw,
            derived_mask_sha256=derived,
            mask_source_sha256s=(source,),
        )
        manifest = replace(manifest, items=(item, *manifest.items[1:]))
        audit = audit_splits(manifest)
        kwargs.update(
            expected_manifest_sha256=manifest.sha256(),
            expected_audit_sha256=sha256_hex(canonical_json(asdict(audit))),
        )
        kwargs["mask_files"].update({raw: mask, derived: derived_path, source: source_path})
        if damage == "raw-mask":
            mask.unlink()
        elif damage == "derived-mask":
            derived_path.write_bytes(b"changed")
        else:
            source_path.unlink()
    called = []
    with pytest.raises(TrainingInputError):
        fit_with_guard(
            lambda: called.append("model"),
            lambda *_: called.append("fit"),
            manifest,
            audit,
            **kwargs,
        )
    assert called == []


@pytest.mark.parametrize("consumer", ["fit_ids", "validation_ids", "tta_ids", "test_export_ids"])
@pytest.mark.parametrize("sentinel", ["synthetic-calibration", "synthetic-release_test"])
def test_synthetic_sealed_sentinels_never_reach_any_consumer(synthetic_inputs, consumer, sentinel):
    manifest, audit, kwargs = synthetic_inputs
    kwargs[consumer] = (*kwargs[consumer], sentinel)
    called = []
    with pytest.raises(TrainingInputError, match="SEALED"):
        fit_with_guard(lambda: called.append("model"), lambda *_: None, manifest, audit, **kwargs)
    assert not called


def synthetic_run_record():
    return dict(
        source_commit="1" * 40,
        dirty_patch_sha256=synthetic_hash("synthetic-diff"),
        upstream_sha="2" * 40,
        dataset_manifest_sha256s=[synthetic_hash("synthetic-manifest")],
        weights_sha256=synthetic_hash("synthetic-weights"),
        environment_lock_sha256=synthetic_hash("synthetic-lock"),
        commands=["synthetic-only train --seed 7"],
        seeds=[7],
        hardware={"device": "synthetic-cpu-double", "driver": "synthetic-none"},
        global_batch=2,
        per_rank_batch=2,
        steps_successful=2,
        steps_attempted=3,
        steps_skipped=1,
        wall_time_s=1.0,
        checkpoint_sha256s=[synthetic_hash("synthetic-ckpt")],
        losses=[1.0, 0.5],
        peak_memory_bytes={"host": 100, "device": 0},
    )


def test_synthetic_reproducibility_record_and_each_required_field():
    record = synthetic_run_record()
    assert validate_run_record(record) == ()
    for key in REQUIRED_RUN_FIELDS:
        incomplete = {k: v for k, v in record.items() if k != key}
        assert f"MISSING:{key}" in validate_run_record(incomplete)


@pytest.mark.parametrize(
    "key,value",
    [
        ("source_commit", "unpinned"),
        ("dirty_patch_sha256", "clean"),
        ("upstream_sha", "main"),
        ("dataset_manifest_sha256s", ["bad"]),
        ("weights_sha256", "bad"),
        ("environment_lock_sha256", "bad"),
        ("seeds", "7"),
        ("commands", []),
        ("steps_skipped", -1),
        ("wall_time_s", float("nan")),
        ("losses", [float("inf")]),
    ],
)
def test_synthetic_run_record_rejects_unpinned_or_invalid_values(key, value):
    record = synthetic_run_record()
    record[key] = value
    assert validate_run_record(record)


def test_synthetic_resume_is_complete_and_never_a_new_independent_seed():
    record = synthetic_run_record()
    resumed = dict(
        record,
        resumed_from=ResumeRecord(
            synthetic_hash("parent"),
            2,
            synthetic_hash("optimizer"),
            synthetic_hash("scaler"),
            "synthetic-resume",
        ),
    )
    assert not validate_run_record(resumed)
    assert independent_seed_count([record, resumed, record]) == 1
    for field, value in (
        ("parent_run_sha256", ""),
        ("epoch", -1),
        ("optimizer_state_sha256", ""),
        ("scaler_state_sha256", ""),
        ("command", ""),
    ):
        broken = dict(resumed, resumed_from=replace(resumed["resumed_from"], **{field: value}))
        assert "RESUME_RECORD_INCOMPLETE" in validate_run_record(broken)
    assert "RESUMED_RUN_IS_NOT_A_NEW_SEED" in validate_run_record(
        dict(resumed, counts_as_independent_seed=True)
    )
    assert "SPEEDUP_CLAIM_WITHOUT_HARDWARE_PROOF" in validate_run_record(
        dict(record, ddp_speedup_claimed=True)
    )


def test_synthetic_fixed_universe_abstentions_unknown_and_absent_support():
    metrics = fabric_metrics(
        ["a", "a", "b", "b", None, None],
        ["a", "a", "b", "b", "a", "b"],
        ["a", None, "b", None, None, "b"],
        ("a", "b", "c"),
    )
    assert metrics.support == {"a": 2, "b": 2, "c": 0}
    assert metrics.insufficient_support == ("c",)
    assert not metrics.full_universe_attained
    assert metrics.unconditional_macro_f1 == pytest.approx(2 / 3)
    assert metrics.deployed_macro_f1 == pytest.approx(4 / 9)
    assert metrics.conditional_macro_f1 == pytest.approx(2 / 3)
    assert metrics.coverage == 0.5
    assert metrics.unknown_precision == pytest.approx(1 / 3)
    assert metrics.unknown_recall == 0.5
    assert set(metrics.per_class) == {"a", "b", "c"}
    assert metrics.support_status == "insufficient support"
    assert fabric_metrics(["a"], ["a"], [None], ("a",)).conditional_macro_f1 is None


def test_synthetic_serialized_resume_record_retains_its_provenance():
    resume = ResumeRecord(synthetic_hash("parent"), 2, synthetic_hash("optimizer"),
                          synthetic_hash("scaler"), "synthetic-resume")
    record = dict(synthetic_run_record(), resumed_from=asdict(resume))
    assert not validate_run_record(json.loads(json.dumps(record)))
    assert independent_seed_count([record]) == 0


def test_synthetic_ineligible_lineage_is_visible_in_pixel_denominators(synthetic_inputs):
    manifest, _, _ = synthetic_inputs
    manifest = replace(manifest, items=(replace(manifest.items[0], mask_sha256=None),))
    denominators = fault_denominators(manifest, "train")
    assert denominators.pixel_eligible == 0
    assert denominators.pixel_excluded == {"valid-clean": 1}


@pytest.mark.parametrize(
    "universe,argmax,answered",
    [
        ((), ["a"], ["a"]),
        (("a", "a"), ["a"], ["a"]),
        (("a",), ["legacy-label"], ["a"]),
        (("a",), ["a"], ["legacy-label"]),
    ],
)
def test_synthetic_fabric_rejects_invalid_label_universes(universe, argmax, answered):
    with pytest.raises(ValueError):
        fabric_metrics(["a"], argmax, answered, universe)


def test_missing_real_bundle_and_loader_are_g6(tmp_path):
    with pytest.raises(BundleUnavailable, match="G6"):
        evaluate_bundle(None, None)
    bundle = Bundle(tmp_path, "not-collected", "0" * 64, "fabric22", ("a",), "0" * 64)
    with pytest.raises(BundleUnavailable, match="G6"):
        evaluate_bundle(bundle, None)


def test_synthetic_bundle_checks_inputs_taxonomy_provenance_and_never_exports_sealed(
    synthetic_inputs,
):
    manifest, audit, kwargs = synthetic_inputs
    root = kwargs["root"]
    weights = root / "synthetic-weights"
    weights.write_bytes(b"synthetic-weights")
    record = synthetic_run_record()
    record["dataset_manifest_sha256s"] = [manifest.sha256()]
    bundle = Bundle(
        root,
        weights.name,
        synthetic_hash("synthetic-weights"),
        "synthetic-fabric22",
        ("a", "b"),
        synthetic_hash("synthetic-preprocess"),
        manifest.sha256(),
        kwargs["expected_audit_sha256"],
        record,
    )
    seen = []

    def synthetic_predictor_double(bound_bundle, ids):
        assert bound_bundle is bundle
        seen.extend(ids)
        return [("a", "a") for _ in ids]

    report = evaluate_bundle(
        bundle,
        manifest,
        predict=synthetic_predictor_double,
        feature_cache=kwargs["feature_cache"],
        feature_files=kwargs["feature_files"],
        mask_files=kwargs["mask_files"],
    )
    assert seen == ["synthetic-validation"]
    assert report.taxonomy_version == "synthetic-fabric22"
    assert report.per_domain_coverage == {"synthetic-domain": 1.0}
    for version in ("fabric24", "fabric27"):
        seen.clear()
        with pytest.raises(ValueError, match="taxonomy"):
            evaluate_bundle(
                replace(bundle, taxonomy_version=version),
                manifest,
                predict=synthetic_predictor_double,
            )
        assert not seen
    for split in ("calibration", "release_test"):
        with pytest.raises(ValueError, match="sealed"):
            evaluate_bundle(bundle, manifest, split=split, predict=synthetic_predictor_double)
    with pytest.raises(BundleUnavailable, match="G6"):
        evaluate_bundle(
            replace(bundle, run_record=None), manifest, predict=synthetic_predictor_double
        )


def test_synthetic_fault_metrics_only_use_eligible_masks_and_valid_pixels(synthetic_inputs):
    from training.qc.evaluate import FaultPrediction, fault_metrics

    manifest, _, _ = synthetic_inputs
    categories = ("valid-clean", "valid-defective", "empty-defective", "absent", "corrupt")
    items = tuple(
        replace(
            manifest.items[0],
            id=f"synthetic-mask-{n}",
            split="validation",
            image_label="normal" if n == 0 else "defective",
            mask_category=c,
        )
        for n, c in enumerate(categories)
    )
    manifest = replace(manifest, items=items)
    denom = fault_denominators(manifest, "validation")
    assert denom.image_defective == 4  # empty mask stays image-level defective
    assert denom.pixel_eligible == 2
    assert denom.pixel_excluded == {"empty-defective": 1, "absent": 1, "corrupt": 1}
    predictions = tuple(
        FaultPrediction(
            i.id,
            0.1 if n == 0 else 0.9,
            (False, bool(n), True) if n < 2 else None,
            (0.1, 0.9 if n else 0.1, 0.0) if n < 2 else None,
            (True, True, False) if n < 2 else None,
        )
        for n, i in enumerate(items)
    )
    with pytest.raises(ValueError, match="blocking"):
        fault_metrics(manifest, "validation", predictions, image_threshold=0.5, pixel_threshold=0.5)
    metrics = fault_metrics(
        manifest,
        "validation",
        predictions,
        image_threshold=0.5,
        pixel_threshold=0.5,
        exploratory=True,
    )
    assert metrics.image_count == 5 and metrics.image_f1 == 1.0
    assert metrics.pixel_count == 4 and metrics.pixel_f1 == 1.0
    assert "MASK_EMPTY_DEFECTIVE_UNRESOLVED" in metrics.audit_blocking
    with pytest.raises(ValueError):
        fault_metrics(
            manifest, "validation", predictions[:-1], image_threshold=0.5, pixel_threshold=0.5
        )


def test_ddp_cli_missing_manifest_fails_g6():
    completed = subprocess.run(
        [
            sys.executable,
            "scripts/qc_ddp_proof.py",
            "--manifest",
            "research/qc/ddp-proof-manifest.json",
        ],
        capture_output=True,
        text=True,
    )
    assert completed.returncode != 0
    assert "G6" in completed.stderr


@pytest.mark.parametrize("missing", ["upstream", "sha", "report"])
def test_ddp_missing_real_evidence_fails_g6(tmp_path, missing):
    from scripts.qc_ddp_proof import verify_ddp_proof

    upstream = tmp_path / "synthetic-upstream"
    upstream.mkdir()
    (upstream / "utils.py").write_text("# synthetic upstream double")
    report = tmp_path / "synthetic-report.json"
    report.write_text("{}")
    with pytest.raises(RuntimeError, match="G6"):
        verify_ddp_proof(
            upstream / "absent" if missing == "upstream" else upstream,
            "" if missing == "sha" else "1" * 40,
            tmp_path / "absent" if missing == "report" else report,
        )


@pytest.mark.parametrize("outcome", ["passed", "skipped", "failed", "absent", "wrong-sha",
    "dirty", "unknown-hardware", "no-nccl", "no-amp", "no-production-loop", "idle-device",
    "missing-report", "bad-counts", "missing-source", "nonfinite-loss", "speedup-unmeasured"])
def test_synthetic_ddp_runner_double_requires_exact_unskipped_test_and_pinned_upstream(
    tmp_path, monkeypatch, outcome
):
    from scripts import qc_ddp_proof as proof

    upstream = tmp_path / "synthetic-upstream"
    upstream.mkdir()
    (upstream / "utils.py").write_text("# synthetic upstream double only")
    report = tmp_path / "synthetic-hardware-report.json"
    record = dict(
        upstream_sha="1" * 40,
        source_commit="2" * 40, dirty_patch_sha256=synthetic_hash("synthetic-source-diff"),
        environment_lock_sha256=synthetic_hash("synthetic-env-lock"),
        backend="nccl",
        amp=True,
        world_size=2,
        optimizer="StableAdamW",
        production_loop=True,
        commands=["synthetic-only production-loop-double"],
        hardware="synthetic-double-only",
        driver="synthetic-double",
        global_batch=16,
        per_rank_batch=8,
        steps_successful=3,
        steps_attempted=3,
        steps_skipped=0,
        losses=[0.5, 0.4, 0.3],
        wall_time_s=2.0,
        peak_memory_bytes=[100, 100],
        checkpoint_sha256s=[synthetic_hash("synthetic-checkpoint")],
        ranks=[
            dict(
                rank=n,
                device_uuid=f"synthetic-device-{n}",
                utilization_percent=50,
                steps_successful=3,
            )
            for n in (0, 1)
        ],
    )
    damages = {
        "unknown-hardware": {"hardware": "unknown"}, "no-nccl": {"backend": "gloo"},
        "no-amp": {"amp": False}, "no-production-loop": {"production_loop": False},
        "bad-counts": {"steps_attempted": 0}, "missing-source": {"source_commit": ""},
        "nonfinite-loss": {"losses": [float("nan")]},
        "speedup-unmeasured": {"speedup_claimed": True},
    }
    record.update(damages.get(outcome, {}))
    if outcome == "idle-device":
        record["ranks"][1]["utilization_percent"] = 0
    report.write_text(json.dumps(record))
    if outcome == "missing-report":
        report.unlink()
    calls = []

    def synthetic_process_runner_double(args, **kwargs):
        calls.append((args, kwargs))
        if args[0] == "git":
            stdout = ("2" * 40 if outcome == "wrong-sha" else "1" * 40) + "\n"
            if "status" in args:
                stdout = " M utils.py" if outcome == "dirty" else ""
            return subprocess.CompletedProcess(args, 0, stdout, "")
        assert kwargs["env"]["DINOMALY_REPO"] == str(upstream.resolve())
        assert proof.NUMERICAL_TEST in args
        xml_path = Path(next(a.split("=", 1)[1] for a in args if a.startswith("--junitxml=")))
        status = {"skipped": "<skipped/>", "failed": "<failure/>"}.get(outcome, "")
        body = (
            ""
            if outcome == "absent"
            else (
                f'<testcase classname="tests.test_fault_dinomaly_ddp" '
                f'name="{proof.NUMERICAL_TEST.split("::")[1]}">{status}</testcase>'
            )
        )
        xml_path.write_text(f"<testsuites><testsuite>{body}</testsuite></testsuites>")
        return subprocess.CompletedProcess(args, 1 if outcome == "failed" else 0, "", "")

    monkeypatch.setattr(proof.subprocess, "run", synthetic_process_runner_double)
    if outcome == "passed":
        assert proof.verify_ddp_proof(upstream, "1" * 40, report) is None
        assert any(proof.NUMERICAL_TEST in args for args, _ in calls)
    else:
        with pytest.raises(RuntimeError, match="G6"):
            proof.verify_ddp_proof(upstream, "1" * 40, report)


def test_synthetic_ddp_cli_requires_actual_bundle_weights(tmp_path, monkeypatch):
    from scripts import qc_ddp_proof as proof

    bundle = tmp_path / "synthetic-bundle.json"
    bundle.write_text(json.dumps(dict(upstream_sha="1" * 40, weights_file="absent-weights",
                                     weights_sha256=synthetic_hash("not-collected"))))
    report = tmp_path / "synthetic-hardware-report.json"
    report.write_text("{}")
    manifest = tmp_path / "synthetic-proof-manifest.json"
    manifest.write_text(json.dumps(dict(bundle_manifest=str(bundle),
        bundle_manifest_sha256=hashlib.sha256(bundle.read_bytes()).hexdigest(),
        upstream=str(tmp_path), expected_sha="1" * 40, report=str(report),
        report_sha256=hashlib.sha256(report.read_bytes()).hexdigest())))
    called = []
    monkeypatch.setattr(proof, "verify_ddp_proof", lambda *_: called.append("synthetic-double"))
    assert proof.main(["--manifest", str(manifest)]) == 1
    assert not called
