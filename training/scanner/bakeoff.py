"""Bake-off on the phone set (spec §8). One backend in memory at a time; every
prediction cached to JSON so reruns and report tweaks never reload a model.

    .venv/bin/python -m training.scanner.bakeoff --phone data/phone \
        --detectors gdino owlv2 florence2 --ocr apple paddle florence2 --bundle models/scanner-v1
"""

from __future__ import annotations

import argparse
import gc
import json
import math
import sys
import time
from dataclasses import replace
from pathlib import Path

from services.vision.datasets.phone import PhoneDataset
from services.vision.garment import choose_primary
from services.vision.imageio import decode_image
from training.scanner.eval_metrics import cer, composition_match, latency, type_accuracy

MARGIN = 0.02  # spec §8.3: within 2 points, the faster backend wins


def _free() -> None:
    gc.collect()
    try:
        import torch

        if torch.backends.mps.is_available():
            torch.mps.empty_cache()
    except ImportError:
        pass


def _cached(path: Path, key: dict, compute):
    """Rows from ``path`` if they were computed for this ``key`` (the garment ids, plus
    whatever else shaped them); otherwise recompute, so a grown set or a new bundle is
    never scored on stale predictions."""
    if path.exists():
        saved = json.loads(path.read_text())
        if isinstance(saved, dict) and saved.get("key") == key:
            return saved["rows"]
    rows = compute()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"key": key, "rows": rows}, indent=1))
    return rows


def run_detector(name: str, samples, loader, cache_dir: Path) -> list[dict]:
    def compute():
        det, rows = loader(), []
        for s in samples:
            row = {"id": s.group_id, "label": None, "score": None, "seconds": None, "error": None}
            try:
                img = decode_image(s.image_path.read_bytes())
                t = time.perf_counter()
                primary = choose_primary(
                    det.detect(img), img.shape[1], img.shape[0], det.default_min_score
                )
                row["seconds"] = time.perf_counter() - t
                if primary is not None:
                    row["label"], row["score"] = primary.label, primary.score
            except Exception as e:  # noqa: BLE001 -- one bad photo is one failed item
                row["error"] = f"{type(e).__name__}: {e}"
            rows.append(row)
        del det
        _free()
        return rows

    ids = [s.group_id for s in samples]
    return _cached(Path(cache_dir) / f"det_{name}.json", {"ids": ids}, compute)


def run_ocr(name: str, samples, loader, cache_dir: Path) -> list[dict]:
    from services.ocr.extract import read_composition

    def compute():
        engine, rows = loader(), []
        for s in samples:
            row = {"id": s.group_id, "fibres": None, "seconds": None, "error": None}
            if s.label_image_path is None:
                row["error"] = "no label photo"
                rows.append(row)
                continue
            try:
                img = decode_image(s.label_image_path.read_bytes())
                t = time.perf_counter()
                ex = read_composition(engine, img)
                row["seconds"] = time.perf_counter() - t
                row["fibres"] = [[f.name, f.pct] for f in ex.fibers] if ex.fibers else None
                row["reason"], row["text"] = ex.reason, ex.text
            except Exception as e:  # noqa: BLE001
                row["error"] = f"{type(e).__name__}: {e}"
            rows.append(row)
        close = getattr(engine, "close", None)
        if close:
            close()
        del engine
        _free()
        return rows

    ids = [s.group_id for s in samples]
    return _cached(Path(cache_dir) / f"ocr_{name}.json", {"ids": ids}, compute)


def pick(results: dict[str, tuple[float, float]]) -> str:
    """results: name -> (score, median seconds). Best score; within MARGIN, the fastest."""
    best = max(score for score, _ in results.values())
    contenders = {n: sec for n, (score, sec) in results.items() if best - score <= MARGIN}
    return min(contenders, key=contenders.get)


def row_latency(rows) -> dict:
    """p50/p95 over the rows that produced a time; infinite when none did, so a backend
    that never answered can't win the §8.3 speed tie-break."""
    times = [r["seconds"] for r in rows if r["seconds"] is not None]
    return latency(times) if times else {"p50": math.inf, "p95": math.inf}


def ocr_scorable(samples) -> tuple[list, list[str], list[str]]:
    """Garments OCR is scored on: a typed label that parses (an unknown fibre such as
    LUREX leaves the denominator, it is not a miss) and a label photo. Returns
    (scorable, ids whose label doesn't parse, ids without a label photo)."""
    from services.vision.datasets.phone import typed_composition

    scorable, unparsed, no_photo = [], [], []
    for s in samples:
        if not typed_composition(s.label_text or ""):
            unparsed.append(s.group_id)
        elif s.label_image_path is None:
            no_photo.append(s.group_id)
        else:
            scorable.append(s)
    return scorable, unparsed, no_photo


def score_ocr(rows: list[dict], scorable) -> dict:
    """Spec §8.2 for one engine: exact match, read rate, and character error rate on the
    composition section (an unread label scores 1.0), plus latency and failures."""
    from services.ocr.parser import FiberPct
    from services.vision.datasets.phone import typed_extraction

    by_id = {r["id"]: r for r in rows}
    exact = read = err = 0.0
    for s in scorable:
        r, truth = by_id[s.group_id], typed_extraction(s.label_text)
        got = [FiberPct(f, pct) for f, pct in (r["fibres"] or [])]
        exact += composition_match(got, truth.fibers)
        read += r["fibres"] is not None
        err += cer(r.get("text") or "", truth.text or "")
    n = max(1, len(scorable))
    failures = sum(r["error"] is not None for r in rows)
    return {"exact": exact / n, "read_rate": read / n, "cer": err / n, **row_latency(rows),
            "failures": failures}  # fmt: skip


def run_vision(tag: str, samples, loader, cache_dir: Path, meta: dict | None = None) -> list[dict]:
    """The full scanner (detector -> SAM -> crop -> heads) per garment photo, cached."""

    def compute():
        predictor, rows = loader(), []
        for s in samples:
            row = {"id": s.group_id, "garment": None, "structure": None, "treatment": None,
                   "family": None, "seconds": None, "error": None}  # fmt: skip
            try:
                data = s.image_path.read_bytes()
                t = time.perf_counter()
                out = predictor.predict(data)
                row["seconds"] = time.perf_counter() - t
                row["garment"] = out.garment.label if out.garment else None
                if out.structure:
                    row["structure"] = [out.structure.label, out.structure.confidence]
                if out.treatment:
                    row["treatment"] = [out.treatment.label, out.treatment.confidence]
                if out.fibre_family:
                    row["family"] = [out.fibre_family.label, out.fibre_family.confidence]
                # the scanner turns a crashed component into a note, not an exception
                crashed = [n.message for n in out.notes if n.code == "COMPONENT_FAILED"]
                if crashed:
                    row["error"] = "; ".join(crashed)
            except Exception as e:  # noqa: BLE001
                row["error"] = f"{type(e).__name__}: {e}"
            rows.append(row)
        del predictor
        _free()
        return rows

    key = {"ids": [s.group_id for s in samples], **(meta or {})}
    return _cached(Path(cache_dir) / f"vision_{tag}.json", key, compute)


def head_accuracy(rows: list[dict], truth: dict[str, str], key: str) -> tuple[float, float, int]:
    """(accuracy, abstentions counted wrong; coverage; n) over the ids in ``truth``."""
    scored = [r for r in rows if r["id"] in truth]
    answered = [r for r in scored if r.get(key)]
    correct = sum(r[key][0] == truth[r["id"]] for r in answered)
    n = len(scored)
    return correct / max(1, n), len(answered) / max(1, n), n


def threshold_records(rows: list[dict], families: dict[str, str]) -> list[dict]:
    from training.scanner.eval_metrics import swap_pairs

    by_id = {r["id"]: r for r in rows if not r.get("error")}
    return [
        {
            "structure": by_id[g]["structure"],
            "treatment": by_id[g].get("treatment"),
            "family": by_id[g]["family"],
            "stated": [families[lab]],
            "should_flag": should,
        }  # fmt: skip
        for g, lab, should in swap_pairs(families)
        if g in by_id
    ]


def vision_section(samples, detector: str, bundle: Path, device, out: Path) -> list[str]:
    from services.consistency.engine import load_kb
    from services.vision.datasets.phone import label_family
    from services.vision.scanner import build_scanner
    from training.scanner.tune_thresholds import choose, evidence_grid, sweep

    single = {
        s.group_id: f
        for s in samples
        if s.label_text and (f := label_family(s.label_text)) not in (None, "blend")
    }
    fabric = {s.group_id: s.fabric for s in samples if s.fabric}
    md = [
        "## Heads on the phone set (domain: phone)",
        "",
        f"Head C scored on {len(single)} single-family garments; Head A on {len(fabric)} "
        "with a known fabric. Abstentions count as wrong.",
        "",
        "| Views | Head C acc | Head C coverage | Head A acc | p50 s | p95 s | Failures |",
        "|---|---|---|---|---|---|---|",
    ]
    results = {}
    for tag, patches in (("crop", False), ("crop+patches", True)):
        rows = run_vision(
            tag,
            samples,
            lambda p=patches: build_scanner(bundle, detector, device, patches=p),
            out,
            meta={"detector": detector, "bundle": str(bundle)},
        )
        c_acc, c_cov, _ = head_accuracy(rows, single, "family")
        a_acc, _, _ = head_accuracy(rows, fabric, "structure")
        lat = row_latency(rows)
        results[tag] = (c_acc, lat["p50"], rows)
        md.append(
            f"| {tag} | {c_acc:.3f} | {c_cov:.2f} | {a_acc:.3f} | {lat['p50']:.2f} "
            f"| {lat['p95']:.2f} | {sum(r['error'] is not None for r in rows)} |"
        )
    views = pick({t: (acc, sec) for t, (acc, sec, _) in results.items()})
    md.append(f"\n**Views (spec §8.3): {views}**\n")

    kb = load_kb()
    tol = kb["tolerance"]
    grid = [round(0.5 + 0.05 * i, 2) for i in range(10)]
    records = threshold_records(results[views][2], single)
    visual = evidence_grid([r["structure"][1] for r in records if r["structure"]], grid,
                           tol["min_visual_confidence"])  # fmt: skip
    family = evidence_grid([r["family"][1] for r in records if r["family"]], grid,
                           tol["family_min_confidence"])  # fmt: skip
    rows = sweep(records, visual, family,
                 kb_fabrics=kb["fabrics"], exempt=kb.get("family_check_exempt", ()))  # fmt: skip
    best = choose(rows, target=0.90)
    n_own = sum(not r["should_flag"] for r in records)
    md += ["## KB thresholds (flag precision on swapped labels)", "",
           f"Domain: phone; n = {n_own} correct-label and {len(records) - n_own} "
           "swapped-label pairs.", ""]  # fmt: skip
    if best is None:
        md.append("No threshold pair reaches 0.90 precision; keep the current kb.yaml values.")
    else:
        md.append(
            f"min_visual_confidence **{best['min_visual_confidence']}**, "
            f"family_min_confidence **{best['family_min_confidence']}**: precision "
            f"{best['precision']:.3f}, recall {best['recall']:.3f}."
        )
    (out / "thresholds.json").write_text(json.dumps({"best": best, "sweep": rows}, indent=1))
    return md


def main(argv: list[str] | None = None) -> int:
    from services.ocr.engines import load_engine
    from services.vision.detectors import load_detector
    from services.vision.runtime import pick_device

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--phone", type=Path, default=Path("data/phone"))
    ap.add_argument("--detectors", nargs="+", default=["gdino", "owlv2", "florence2"])
    ap.add_argument("--ocr", nargs="+", default=["apple", "paddle", "florence2"])
    ap.add_argument("--out", type=Path, default=Path("results/bakeoff"))
    ap.add_argument("--bundle", type=Path, default=Path("models/scanner-v1"))
    args = ap.parse_args(argv)

    ds = PhoneDataset(args.phone)
    samples = list(ds)
    device = pick_device()
    md = [f"# Bake-off (domain: phone, n = {len(samples)} garments)", ""]
    if ds.missing:
        md.append(f"Rows without a garment photo, excluded: {', '.join(ds.missing)}\n")
    if ds.duplicates:
        md.append(f"Repeated ids, first row kept: {', '.join(ds.duplicates)}\n")

    # Label close-ups hold no whole garment: a detector that "finds" one there can't say
    # "no garment" (Florence-2 grounds its caption somewhere in any photo).
    closeups = [replace(s, image_path=s.label_image_path, group_id=f"{s.group_id}#label")
                for s in samples if s.label_image_path]  # fmt: skip
    det_scores = {}
    md += [
        "## Garment detectors",
        "",
        f"Garment in label close-ups: how often a detector claims a garment in the "
        f"{len(closeups)} label photos (lower is better; not part of the §8.3 rule).",
        "",
        "| Backend | Type accuracy | Garment in label close-ups | p50 s | p95 s | Failures |",
        "|---|---|---|---|---|---|",
    ]
    for name in args.detectors:
        both = run_detector(
            name, samples + closeups, lambda n=name: load_detector(n, device), args.out
        )
        rows, on_labels = both[: len(samples)], both[len(samples) :]
        acc = type_accuracy([r["label"] for r in rows], [s.garment_type for s in samples])
        claimed = sum(r["label"] is not None for r in on_labels) / max(1, len(on_labels))
        lat = row_latency(rows)
        det_scores[name] = (acc, lat["p50"])
        md.append(
            f"| {name} | {acc:.3f} | {claimed:.3f} | {lat['p50']:.2f} | {lat['p95']:.2f} "
            f"| {sum(r['error'] is not None for r in rows)} |"
        )
    md.append(f"\n**Default detector (spec §8.3): {pick(det_scores)}**\n")

    scorable, unparsed, no_photo = ocr_scorable(samples)
    ocr_scores = {}
    md += [
        "## OCR engines",
        "",
        f"Scored on {len(scorable)} garments. Excluded: {len(unparsed)} whose typed label "
        f"doesn't parse, {len(no_photo)} without a label photo. CER is on the composition "
        "section; an unread label counts 1.0.",
        "",
        "| Engine | Exact match | Read rate | CER | p50 s | Failures |",
        "|---|---|---|---|---|---|",
    ]
    for name in args.ocr:
        rows = run_ocr(name, scorable, lambda n=name: load_engine(n), args.out)
        sc = score_ocr(rows, scorable)
        ocr_scores[name] = (sc["exact"], sc["p50"])
        md.append(
            f"| {name} | {sc['exact']:.3f} | {sc['read_rate']:.3f} | {sc['cer']:.3f} "
            f"| {sc['p50']:.2f} | {sc['failures']} |"
        )
    md.append(f"\n**Default OCR engine (spec §8.3): {pick(ocr_scores)}**\n")
    md += vision_section(samples, pick(det_scores), args.bundle, device, args.out)

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "bakeoff.md").write_text("\n".join(md) + "\n")
    print(f"wrote {args.out / 'bakeoff.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
