"""Request-local evidence assembly. Only qc_policy decides a sample's status.

No ScanStore, image/result cache, trained stand-ins or implied domain release. Physical
artifacts are addressed by hash through C01's ArtifactStore. G3/G6 remain external gates.
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from services.api.qc_schemas import (
    STAGE_NAMES,
    AnalysisBinding,
    AnalysisCandidate,
    AnalyzeRequest,
    DefectRegion,
    DefectValue,
    DefectView,
    DomainManifest,
    EvaluationContext,
    Evidence,
    FabricCandidate,
    FabricValue,
    Policy,
    PurchaseSpec,
    Readiness,
    ReadinessStage,
    Release,
    Stage,
    ValidatedCapture,
    content_sha256,
    fabric_artifact_sha256,
    sha256_hex,
)
from services.api.qc_service_auth import timestamp
from services.consistency import qc_policy
from services.vision.predictor import StubPredictor, VisionOutput
from services.vision.qc_imageio import DecodedOriginal, derivative
from services.vision.qc_metrology import measure_construction
from services.vision.qc_quality import ArtifactStore, QualityView, assess_capture_set

wall_time = time.time  # monkeypatch point, same pattern as qc.py
# ponytail: calibration knob, CPU seconds per view. Measured 21 Nov 2026 on this Mac (nice 10,
# cpu, fault-wfdd-v1, synthetic 1600x1200): 4.7 s and 4.9 s per detect(). 10 s leaves 2x headroom.
DEFECT_VIEW_BUDGET_S = 10.0


@dataclass(frozen=True)
class CaptureBatch:
    """Verified originals plus immutable metadata; revision travels outside evidence context.

    AnalyzeRequest intentionally has no bytes field. The transport constructs this batch
    only after every file hash and decoded original has been verified.
    """

    captures: tuple[ValidatedCapture, ...]
    originals: dict[str, DecodedOriginal]
    expected_revision: int

    @classmethod
    def from_request(cls, request: AnalyzeRequest, originals: dict[str, DecodedOriginal]):
        if set(originals) != {v.capture.id for v in request.captures}:
            raise ValueError("original membership mismatch")
        for view in request.captures:
            if originals[view.capture.id].sha256 != view.verified_sha256:
                raise ValueError("original hash mismatch")
        return cls(tuple(request.captures), dict(originals), request.expected_revision)


def unavailable(state="DISABLED", reason="STAGE_UNAVAILABLE") -> Stage:
    return Stage(state=state, value=None, reasons=[reason], artifact_sha256=None, duration_ms=0.0)


def _independent(fn) -> Stage:
    start = time.perf_counter()
    try:
        stage = fn()
    except Exception:  # noqa: BLE001 -- report stage failure; keep running the other stages
        stage = unavailable("FAILED")
    return stage.model_copy(update={"duration_ms": 1000 * (time.perf_counter() - start)})


def _fabric(batch: CaptureBatch, predictor) -> Stage:
    if predictor is None or isinstance(predictor, StubPredictor):
        return unavailable()
    heads = getattr(predictor, "heads", None)
    artifact = getattr(predictor, "qc_artifact_sha256", None)
    taxonomy = getattr(predictor, "qc_taxonomy_version", None)
    if heads is None or artifact is None or taxonomy is None:
        return unavailable()
    views = []
    for view in batch.captures:
        if view.capture.role != "structure":
            continue
        original = batch.originals[view.capture.id]
        # No legacy decode_image(1600), garment detector, cropper or six-tile reduction.
        rgb, _ = derivative(original.rgb, max(original.upright_size), "qc-flat-structure")
        views.append(rgb)
    if not views:
        return unavailable("ABSTAINED")
    out = heads.predict(views)
    answer = out.structure
    candidates = answer.topk if answer is not None else out.candidates.get("structure", [])
    if answer is None and not candidates:
        return unavailable("FAILED")
    # The artifact is the released model plus its fixed derivation/aggregation contract. A
    # request's captures are not part of it: release tooling computes the same value for the
    # DomainManifest, and per-capture changes must not break that binding.
    binding = fabric_artifact_sha256(artifact, taxonomy)
    return Stage[FabricValue](
        state="OK",
        value=FabricValue(
            label=answer.label if answer else None,
            taxonomy_version=taxonomy,
            calibrated_probability=None,
            unknown=answer is None,
            candidates=[
                FabricCandidate(label=label, raw_score=float(score))
                for label, score in candidates[:10]
            ],
        ),
        reasons=["UNKNOWN_FABRIC"] if answer is None else [],
        artifact_sha256=binding,
        duration_ms=0.0,
    )


def _defects(batch: CaptureBatch, predictor, deadline_at: str) -> Stage:
    """Fault model on flat-swatch captures. One view it cannot judge makes the stage abstain."""
    fault = getattr(predictor, "fault", None)
    digest = getattr(predictor, "qc_fault_artifact_sha256", None)
    if fault is None or digest is None:
        return unavailable()
    # The scale card is a foreign object the map would mark by design: never scored (plan D1).
    views = [v for v in batch.captures if v.capture.role == "defect"] or [
        v for v in batch.captures if v.capture.role in ("overview", "structure")
    ]
    if not views:
        return unavailable("ABSTAINED", "QUALITY_FRAMING")
    clamp = lambda x: min(1.0, max(0.0, float(x)))  # noqa: E731
    # float rounding in the photo-space mapping can land a hair outside [0, 1]
    unit_box = lambda b: tuple(clamp(c) for c in b)  # noqa: E731
    seen, regions, flagged = [], [], False
    for view in views:
        if timestamp(deadline_at) - wall_time() < DEFECT_VIEW_BUDGET_S:
            return unavailable("ABSTAINED", "STAGE_UNAVAILABLE")
        rgb, _ = derivative(batch.originals[view.capture.id].rgb, 1600, "qc-defect")
        out = fault.detect(rgb, None)  # flat swatch: no garment box
        if getattr(out, "reference", None) != "trained":
            return unavailable("ABSTAINED", "OOD")
        cid, tid = view.capture.id, "qc-defect-max1600"
        seen.append(
            DefectView(
                capture_id=cid,
                capture_sha256=view.verified_sha256,
                transform_id=tid,
                score=clamp(out.score),
                observed_area_cm2=None,
            )
        )
        regions += [
            DefectRegion(
                capture_id=cid,
                transform_id=tid,
                box=b,
                score=clamp(r.score),
                label=getattr(r, "type", None),
            )
            for r in out.regions
            for b in [unit_box(r.box)]
            if b[0] < b[2] and b[1] < b[3]
        ]
        flagged = flagged or bool(out.is_fault)
    return Stage[DefectValue](
        state="OK",
        value=DefectValue(
            score=max(v.score for v in seen),
            regions=regions,
            observed_area_cm2=0.0,  # no physical scale on a defect view
            views=seen,
        ),
        reasons=["DEFECT_SUSPECTED"] if flagged else [],
        artifact_sha256=digest,
        duration_ms=0.0,
    )


def _metrology(batch, spec, domain, artifacts, context):
    stages = []
    for view in batch.captures:
        if view.capture.role != "structure":
            continue
        stages.append(
            measure_construction(
                batch.originals[view.capture.id].rgb,
                view.calibration,
                view.reference,
                capture=view.capture,
                attestation=view.attestation,
                axis_registration=view.axis_registration,
                construction=spec.construction,
                validation_sha256=domain.metrology_validation_sha256 if domain else None,
                artifacts=artifacts,
                now=context.evaluated_at,
            )
        )
    if not stages:
        return unavailable("ABSTAINED", "MEASUREMENT_UNCERTAIN")
    if len(stages) == 1:
        return stages[0]
    # No validated multi-view construction reducer exists. Do not cherry-pick the view
    # closest to the PO or let a successful view hide a failed required view.
    reasons = list(dict.fromkeys(r for s in stages for r in s.reasons))
    return Stage(
        state="FAILED" if any(s.state == "FAILED" for s in stages) else "ABSTAINED",
        value=None,
        reasons=list(dict.fromkeys([*reasons, "MEASUREMENT_UNCERTAIN"]))[:12],
        artifact_sha256=None,
        duration_ms=0.0,
    )


def run_qc_analysis(
    captures: CaptureBatch,
    spec: PurchaseSpec,
    domain: DomainManifest | None,
    predictor,
    policy: Policy,
    release: Release | None,
    attempt: int,
    context: EvaluationContext,
) -> AnalysisCandidate:
    artifacts = ArtifactStore(os.environ.get("TEXPILOT_QC_ARTIFACTS"))
    quality = _independent(
        lambda: assess_capture_set(
            [
                QualityView(v.capture.id, v.capture.role, captures.originals[v.capture.id].rgb)
                for v in captures.captures
            ],
            domain.quality_thresholds_sha256 if domain else None,
            artifacts,
        )
    )
    fabric = _independent(lambda: _fabric(captures, predictor))
    defects = _independent(lambda: _defects(captures, predictor, context.deadline_at))
    metrology = _independent(lambda: _metrology(captures, spec, domain, artifacts, context))
    # A request's manifest is not a released domain-assessment executable artifact.
    domain_stage = _independent(lambda: unavailable("DISABLED", "DOMAIN_UNVALIDATED"))
    evidence = Evidence(
        schema_version="2",
        id=str(uuid4()),
        sample_id=captures.captures[0].capture.sample_id,
        capture_ids=[v.capture.id for v in captures.captures],
        spec_sha256=spec.content_sha256,
        domain_id=domain.id if domain else None,
        quality=quality,
        fabric=fabric,
        defects=defects,
        metrology=metrology,
        domain=domain_stage,
        contradictions=[],
        manifest_sha256="0" * 64,
        created_at=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    )
    evidence = evidence.model_copy(
        update={
            "manifest_sha256": content_sha256(
                evidence, exclude=("manifest_sha256", "id", "created_at")
            )
        }
    )
    draft = qc_policy.evaluate_qc(evidence, spec, policy, release, attempt, context, domain=domain)
    return AnalysisCandidate(
        evidence=evidence,
        draft=draft,
        binding=AnalysisBinding(
            spec_sha256=spec.content_sha256,
            policy_sha256=policy.sha256,
            release_sha256=release.sha256 if release else None,
            capture_sha256s=[v.verified_sha256 for v in captures.captures],
            attempt=attempt,
            expected_revision=captures.expected_revision,
            request_id=context.request_id,
            request_generation=context.request_generation,
            deadline_at=context.deadline_at,
        ),
    )


def qc_readiness(predictor=None) -> Readiness:
    """Usable artifacts, never an authority claim. No missing stage can become ready."""
    artifact = getattr(predictor, "qc_artifact_sha256", None)
    fault = getattr(predictor, "qc_fault_artifact_sha256", None)
    rows = []
    for name in STAGE_NAMES:
        digest = {"fabric": artifact, "defects": fault}.get(name)
        state = "OK" if digest else "DISABLED"
        reason = "DOMAIN_UNVALIDATED" if name == "domain" else "STAGE_UNAVAILABLE"
        rows.append(
            ReadinessStage(
                name=name, state=state, artifact_sha256=digest, reasons=[] if digest else [reason]
            )
        )
    return Readiness(schema_version="2", ready=False, bundle_sha256=artifact, stages=rows)


class _SelectedStructureHeads:
    def __init__(self, head):
        self.head = head

    def predict(self, views):
        from services.vision.heads import closest, decide

        probs = self.head.probs(views)
        answer = decide(probs, self.head.classes, self.head.meta["threshold"])
        return VisionOutput(
            answer,
            None,
            None,
            candidates=(
                {} if answer is not None else {"structure": closest(probs, self.head.classes)}
            ),
        )


@dataclass(frozen=True)
class FlatSwatchPredictor:
    heads: _SelectedStructureHeads
    qc_artifact_sha256: str
    qc_taxonomy_version: str
    fault: object | None = None
    qc_fault_artifact_sha256: str | None = None


def load_flat_swatch_predictor(settings) -> FlatSwatchPredictor:
    """Local selected Head A only. No detector construction or pretrained downloads."""
    root = Path(settings.bundle)
    bundle = json.loads((root / "bundle.json").read_bytes())
    head_dir = root / bundle["structure_model"]["dir"]
    meta = json.loads((head_dir / "head.json").read_bytes())
    files = [root / "bundle.json", head_dir / "head.json"]
    if meta.get("pool") == "probe":
        files += [head_dir / "probe.safetensors", head_dir / "encoder.safetensors"]
    else:
        files += [head_dir / "model.safetensors"]
    # Read every required local file before constructing models: no network fallback.
    hashes = {str(p.relative_to(root)): sha256_hex(p.read_bytes()) for p in files}
    from services.vision.heads import FineTunedHead
    from services.vision.runtime import pick_device
    from services.vision.taxonomy import FABRIC_CLASSES

    head = FineTunedHead(head_dir, pick_device(settings.device))
    scope24 = tuple(c for c in FABRIC_CLASSES if c not in {"jersey", "canvas", "plush"})
    taxonomy = (
        "fabric24-head_a"
        if tuple(head.classes) == scope24
        else "fabric-scope-" + content_sha256({"labels": list(head.classes)})[:24]
    )
    return FlatSwatchPredictor(
        _SelectedStructureHeads(head),
        content_sha256({"files": hashes, "labels": head.classes}),
        taxonomy,
    )
