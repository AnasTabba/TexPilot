"""Bake-off on the phone set (spec §8). One backend in memory at a time; every
prediction cached to JSON so reruns and report tweaks never reload a model.

    .venv/bin/python -m training.scanner.bakeoff --phone data/phone \
        --detectors gdino owlv2 --ocr apple paddle --bundle models/scanner-v1
"""

from __future__ import annotations

import argparse
import gc
import json
import sys
import time
from pathlib import Path

from services.vision.datasets.phone import PhoneDataset
from services.vision.garment import choose_primary
from services.vision.imageio import decode_image
from training.scanner.eval_metrics import composition_match, latency, type_accuracy

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
                row["reason"] = ex.reason
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


def run_vision(tag: str, samples, loader, cache_dir: Path, meta: dict | None = None) -> list[dict]:
    """The full scanner (detector -> SAM -> crop -> heads) per garment photo, cached."""

    def compute():
        predictor, rows = loader(), []
        for s in samples:
            row = {"id": s.group_id, "garment": None, "structure": None, "family": None,
                   "seconds": None, "error": None}  # fmt: skip
            try:
                data = s.image_path.read_bytes()
                t = time.perf_counter()
                out = predictor.predict(data)
                row["seconds"] = time.perf_counter() - t
                row["garment"] = out.garment.label if out.garment else None
                if out.structure:
                    row["structure"] = [out.structure.label, out.structure.confidence]
                if out.fibre_family:
                    row["family"] = [out.fibre_family.label, out.fibre_family.confidence]
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
        "| Views | Head C acc | Head C coverage | Head A acc | p50 s | p95 s |",
        "|---|---|---|---|---|---|",
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
        lat = latency([r["seconds"] for r in rows if r["seconds"] is not None] or [0.0])
        results[tag] = (c_acc, lat["p50"], rows)
        md.append(
            f"| {tag} | {c_acc:.3f} | {c_cov:.2f} | {a_acc:.3f} | {lat['p50']:.2f} "
            f"| {lat['p95']:.2f} |"
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
    from services.ocr.parser import FiberPct
    from services.vision.datasets.phone import typed_composition
    from services.vision.detectors import load_detector
    from services.vision.runtime import pick_device

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--phone", type=Path, default=Path("data/phone"))
    ap.add_argument("--detectors", nargs="+", default=["gdino", "owlv2"])
    ap.add_argument("--ocr", nargs="+", default=["apple", "paddle"])
    ap.add_argument("--out", type=Path, default=Path("results/bakeoff"))
    ap.add_argument("--bundle", type=Path, default=Path("models/scanner-v1"))
    args = ap.parse_args(argv)

    ds = PhoneDataset(args.phone)
    samples = list(ds)
    device = pick_device()
    md = [f"# Bake-off (domain: phone, n = {len(samples)} garments)", ""]
    if ds.missing:
        md.append(f"Rows without a garment photo, excluded: {', '.join(ds.missing)}\n")

    det_scores = {}
    md += [
        "## Garment detectors",
        "",
        "| Backend | Type accuracy | p50 s | p95 s | Failures |",
        "|---|---|---|---|---|",
    ]
    for name in args.detectors:
        rows = run_detector(name, samples, lambda n=name: load_detector(n, device), args.out)
        acc = type_accuracy([r["label"] for r in rows], [s.garment_type for s in samples])
        lat = latency([r["seconds"] for r in rows if r["seconds"] is not None] or [0.0])
        det_scores[name] = (acc, lat["p50"])
        md.append(
            f"| {name} | {acc:.3f} | {lat['p50']:.2f} | {lat['p95']:.2f} "
            f"| {sum(r['error'] is not None for r in rows)} |"
        )
    md.append(f"\n**Default detector (spec §8.3): {pick(det_scores)}**\n")

    def truth(s):
        return typed_composition(s.label_text or "")

    scored = [s for s in samples if truth(s)]
    ocr_scores = {}
    md += [
        "## OCR engines",
        "",
        f"Scored on {len(scored)} garments whose typed label parses "
        f"({len(samples) - len(scored)} excluded).",
        "",
        "| Engine | Exact match | p50 s | Failures |",
        "|---|---|---|---|",
    ]
    for name in args.ocr:
        rows = {r["id"]: r for r in run_ocr(name, scored, lambda n=name: load_engine(n), args.out)}
        hits = [
            composition_match(
                [FiberPct(n, p) for n, p in (rows[s.group_id]["fibres"] or [])], truth(s)
            )
            for s in scored
        ]
        rate = sum(hits) / max(1, len(hits))
        lat = latency([r["seconds"] for r in rows.values() if r["seconds"] is not None] or [0.0])
        ocr_scores[name] = (rate, lat["p50"])
        md.append(
            f"| {name} | {rate:.3f} | {lat['p50']:.2f} "
            f"| {sum(r['error'] is not None for r in rows.values())} |"
        )
    md.append(f"\n**Default OCR engine (spec §8.3): {pick(ocr_scores)}**\n")
    md += vision_section(samples, pick(det_scores), args.bundle, device, args.out)

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "bakeoff.md").write_text("\n".join(md) + "\n")
    print(f"wrote {args.out / 'bakeoff.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
