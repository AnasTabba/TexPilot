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
    sha256_hex,
)
from services.consistency import qc_policy
from services.vision.predictor import StubPredictor, VisionOutput
from services.vision.qc_imageio import DecodedOriginal, derivative
from services.vision.qc_metrology import measure_construction
from services.vision.qc_quality import ArtifactStore, QualityView, assess_capture_set


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
    views, transforms = [], []
    for view in batch.captures:
        if view.capture.role != "structure":
            continue
        original = batch.originals[view.capture.id]
        # No legacy decode_image(1600), garment detector, cropper or six-tile reduction.
        rgb, resize = derivative(original.rgb, max(original.upright_size), "qc-flat-structure")
        views.append(rgb)
        transforms.append(
            {"capture_id": view.capture.id, "original": original.transform, "derivative": resize}
        )
    if not views:
        return unavailable("ABSTAINED")
    out = heads.predict(views)
    answer = out.structure
    candidates = answer.topk if answer is not None else out.candidates.get("structure", [])
    if answer is None and not candidates:
        return unavailable("FAILED")
    # Transform/role/aggregation changes alter the artifact binding. Historical scanner-v8
    # probability calibration does not match the served logits (removed class bias).
    binding = content_sha256(
        {
            "model_sha256": artifact,
            "taxonomy": taxonomy,
            "views": transforms,
            "aggregation": "head-probs-mean-v1",
        }
    )
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
    # FaultDetector._load_model is NotImplementedError today. Neither a configured path
    # nor a legacy fault-like object proves a real loadable/validated artifact (G6).
    defects = _independent(unavailable)
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
    rows = []
    for name in STAGE_NAMES:
        state, digest = ("OK", artifact) if name == "fabric" and artifact else ("DISABLED", None)
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
