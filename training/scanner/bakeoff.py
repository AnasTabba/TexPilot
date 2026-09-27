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


def _cached(path: Path, compute):
    if path.exists():
        return json.loads(path.read_text())
    rows = compute()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows, indent=1))
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

    return _cached(Path(cache_dir) / f"det_{name}.json", compute)


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

    return _cached(Path(cache_dir) / f"ocr_{name}.json", compute)


def pick(results: dict[str, tuple[float, float]]) -> str:
    """results: name -> (score, median seconds). Best score; within MARGIN, the fastest."""
    best = max(score for score, _ in results.values())
    contenders = {n: sec for n, (score, sec) in results.items() if best - score <= MARGIN}
    return min(contenders, key=contenders.get)


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

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "bakeoff.md").write_text("\n".join(md) + "\n")
    print(f"wrote {args.out / 'bakeoff.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
