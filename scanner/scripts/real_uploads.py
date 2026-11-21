"""Real-upload triage, frozen re-run and coverage report (coverage, not accuracy).

cd scanner && nice -n 10 ../.venv/bin/python scripts/real_uploads.py \
    triage|rerun|report --out runs/real_uploads/2026-11-22

triage: scans store -> manifest.csv (unique images, source, exclusions, near-duplicate groups).
rerun:  frozen v8 + fault pipeline, non-excluded photos, photo only (no label text)
        -> predictions.jsonl, run_info.json.
report: coverage.md + coverage.json. Models load only in `rerun`; the other two need no torch.
Never reads stored results, never writes to data/scans, never writes a label.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import sqlite3
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

COLS = [
    "image_sha", "ext", "width", "height", "source", "excluded", "exclude_reason", "group_id",
    "n_uploads", "scan_ids", "first_seen", "model_versions", "label_text_present",
]  # fmt: skip
WEB = {"PNG", "WEBP", "GIF", "BMP"}
MIN_N = 30
# Documented catalogue figures (docs/agent1-abstain-results.md, docs/results.md); others have none.
CATALOGUE = {
    "structure": "0.8201 coverage on catalogue test (docs/agent1-abstain-results.md)",
    "custom.mix": "53.2% answers given on catalogue test (docs/results.md)",
}


def dhash(im: Image.Image) -> int:
    px = im.convert("L").resize((9, 8)).tobytes()
    bits = 0
    for r in range(8):
        for c in range(8):
            bits = (bits << 1) | (px[r * 9 + c] > px[r * 9 + c + 1])
    return bits


def inspect(data: bytes) -> dict:
    try:
        im = Image.open(io.BytesIO(data))
        fmt = im.format
        im.load()
    except Exception:  # noqa: BLE001 -- any decode failure is an exclusion, listed not silent
        return {"excluded": "yes", "reason": "undecodable", "source": "web_format"}
    d = {"w": im.width, "h": im.height, "hash": dhash(im), "excluded": "no", "reason": ""}
    if fmt == "JPEG":
        ex = im.getexif()
        d["source"] = "camera_exif" if (ex.get(271) or ex.get(272)) else "jpeg_no_exif"
    else:
        d |= {"source": "web_format", "excluded": "yes", "reason": f"web format {fmt}"}
    return d


def groups(items: dict[str, int]) -> dict[str, str]:
    """sha -> group id (smallest sha).

    ponytail: O(n^2) over ~135 images, use a BK-tree past ~5,000.
    """
    parent = {s: s for s in items}

    def find(s):
        while parent[s] != s:
            parent[s] = parent[parent[s]]
            s = parent[s]
        return s

    shas = sorted(items)
    for i, a in enumerate(shas):
        for b in shas[i + 1 :]:
            if bin(items[a] ^ items[b]).count("1") <= 6:
                ra, rb = find(a), find(b)
                parent[max(ra, rb)] = min(ra, rb)
    return {s: find(s) for s in shas}


def triage(photos: Path, db: Path, out: Path) -> list[dict]:
    rows: dict[str, tuple] = {}
    if Path(db).exists():
        con = sqlite3.connect(db)
        rows = {r[0]: r[1:] for r in con.execute(
            "select scan_id, timestamp, model_version, label_text from scans")}  # fmt: skip
        con.close()
    by_sha: dict[str, list[Path]] = defaultdict(list)
    for p in sorted(Path(photos).glob("*_garment.*")):
        by_sha[hashlib.sha256(p.read_bytes()).hexdigest()].append(p)
    info = {s: inspect(ps[0].read_bytes()) for s, ps in by_sha.items()}
    gid = groups({s: i["hash"] for s, i in info.items() if i["excluded"] == "no"})
    manifest = []
    for sha in sorted(by_sha):
        ps, i = by_sha[sha], info[sha]
        ids = [p.name.split("_garment.")[0] for p in ps]
        db_rows = [rows[s] for s in ids if s in rows]
        manifest.append({
            "image_sha": sha, "ext": ps[0].suffix.lstrip(".").lower(),
            "width": i.get("w", ""), "height": i.get("h", ""), "source": i["source"],
            "excluded": i["excluded"], "exclude_reason": i["reason"], "group_id": gid.get(sha, sha),
            "n_uploads": len(ps), "scan_ids": ";".join(ids),
            "first_seen": min((r[0] for r in db_rows), default=""),
            "model_versions": ";".join(sorted({r[1] for r in db_rows})),
            "label_text_present": "yes" if any((r[2] or "").strip() for r in db_rows) else "no",
        })  # fmt: skip
    out.mkdir(parents=True, exist_ok=True)
    with open(out / "manifest.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, COLS)
        w.writeheader()
        w.writerows(manifest)
    n_files = sum(len(v) for v in by_sha.values())
    print(f"{len(manifest)} unique images from {n_files} files")
    for k, v in sorted(Counter(r["source"] for r in manifest).items()):
        print(f"  source {k}: {v}")
    for r in manifest:
        if r["excluded"] == "yes":
            print(f"  excluded {r['image_sha'][:12]}: {r['exclude_reason']}")
    return manifest


def rerun(photos: Path, out: Path, device: str) -> None:
    from services.api.config import Settings, build_predictor
    from services.api.pipeline import run_scan
    from services.vision.errors import UnsupportedImage

    manifest = read_manifest(out)
    todo = [r for r in manifest if r["excluded"] != "yes"]
    pred_path = out / "predictions.jsonl"
    done = {p["image_sha"] for p in read_jsonl(pred_path)}
    s = Settings(vision="scanner", bundle=Path("models/scanner-v8"), detector="owlv2", ocr="none",
                 device=device, store="none", fault_model=Path("models/fault-wfdd-v1"))  # fmt: skip
    predictor, version = build_predictor(s)
    with open(pred_path, "a", encoding="utf-8") as f:
        for r in todo:
            if r["image_sha"] in done:
                continue
            path = Path(photos) / f"{r['scan_ids'].split(';')[0]}_garment.{r['ext']}"
            try:  # never label_text: the photo-only answer
                res = run_scan(predictor, path.read_bytes(), model_version=version)
                line = {
                    "image_sha": r["image_sha"],
                    "result": res.model_dump(mode="json"),
                    "error": None,
                }
            except UnsupportedImage as e:
                line = {"image_sha": r["image_sha"], "result": None, "error": str(e)}
            f.write(json.dumps(line) + "\n")
            f.flush()
    preds = read_jsonl(pred_path)
    try:
        import torch

        tv = torch.__version__
    except ImportError:
        tv = None
    git = lambda *a: subprocess.run(["git", *a], capture_output=True, text=True).stdout.strip()  # noqa: E731
    info = {
        "git_commit": git("rev-parse", "HEAD"), "git_dirty": bool(git("status", "--porcelain")),
        "model_version": version, "device": device, "torch": tv, "date": date.today().isoformat(),
        "n_to_evaluate": len(todo), "n_predictions": len(preds),
        "n_errors": sum(1 for p in preds if p["error"]),
    }  # fmt: skip
    (out / "run_info.json").write_text(json.dumps(info, indent=2))
    print(json.dumps(info))


def read_manifest(out: Path) -> list[dict]:
    p = out / "manifest.csv"
    if not p.exists():
        return []
    with open(p, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def read_jsonl(p: Path) -> list[dict]:
    if not p.exists():
        return []
    return [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()]


def fault_bucket(f: dict | None) -> str:
    if f is None:
        return "absent"
    if f.get("skipped_reason"):
        return "skipped"
    return f["reference"] if f.get("reference") in ("trained", "self_relative") else "unknown"


def coverage(preds: list[dict]) -> dict:
    ok = [p["result"] for p in preds if p.get("result")]
    heads: dict[str, dict] = {}

    def add(name: str, answered: bool) -> None:
        h = heads.setdefault(name, {"answered": 0, "n": 0})
        h["n"] += 1
        h["answered"] += answered

    fault: dict[str, dict] = {}
    for r in ok:
        sa = r.get("structure_answer")
        add("structure", (not sa["unknown"]) if sa else r.get("structure") is not None)
        for k in ("fibre_family", "treatment"):
            add(k, r.get(k) is not None)
        add("garment", r.get("garment") is not None)
        for k, v in (r.get("custom") or {}).items():
            add(f"custom.{k}", v is not None)
        f = r.get("fault")
        b = fault.setdefault(fault_bucket(f), {"n": 0, "flagged": 0})
        b["n"] += 1
        b["flagged"] += bool(f and f.get("is_fault") and not f.get("skipped_reason"))
    return {"n": len(ok), "errors": len(preds) - len(ok), "heads": heads, "fault": fault}


def report_text(manifest: list[dict], preds: list[dict], run_info: dict | None) -> str:
    kept = [r for r in manifest if r["excluded"] != "yes"]
    by_id = {r["image_sha"]: r for r in manifest}
    ev = [by_id[p["image_sha"]] for p in preds if p["image_sha"] in by_id]
    L = ["# Real-upload report: coverage on real uploads, not accuracy", ""]
    L.append(f"Unique images: {len(manifest)}; excluded: {len(manifest) - len(kept)}")
    for k, v in sorted(
        Counter(r.get("exclude_reason", "") for r in manifest if r["excluded"] == "yes").items()
    ):
        L.append(f"- excluded, {k}: {v}")
    L.append(
        f"Images with no scan-store row: {sum(1 for r in manifest if not r.get('model_versions'))}"
    )
    L.append("")
    if not kept:
        return "\n".join(L + ["There are no non-excluded images to evaluate.", ""])
    L.append(
        f"Evaluated: {len(ev)} images in {len({r['group_id'] for r in ev})} near-duplicate groups"
    )
    for k, v in sorted(Counter(r["source"] for r in ev).items()):
        L.append(f"- {k}: {v}")
    L.append("")
    c = coverage(preds)
    if c["n"] < MIN_N:
        L.append(f"n={c['n']}: too few to summarise")
        return "\n".join(L + [""])
    L.append(f"Errors (image refused by the scanner): {c['errors']}")
    L += ["", "## Head answer rate (answered / n) vs catalogue reference", ""]
    for name, h in sorted(c["heads"].items()):
        ref = CATALOGUE.get(name, "no catalogue figure")
        L.append(
            f"- {name}: answer rate {h['answered']}/{h['n']} = "
            f"{h['answered'] / h['n']:.1%}; catalogue: {ref}"
        )
    L += [
        "",
        "## Fault check by rule (flag rate is within each bucket, not a false-alarm rate)",
        "",
    ]
    for b, v in sorted(c["fault"].items()):
        rate = "-" if b == "skipped" else f"{v['flagged']}/{v['n']} = {v['flagged'] / v['n']:.1%}"
        L.append(f"- {b}: n={v['n']}, flagged {rate}")
    k = sum(1 for r in ev if r.get("label_text_present") == "yes")
    L += ["", f"composition: not measurable ({k} label texts)", ""]
    if run_info:
        L.append(
            f"Run: {run_info.get('model_version')} on {run_info.get('device')}, "
            f"commit {run_info.get('git_commit')}"
        )
    return "\n".join(L + [""])


def report(out: Path) -> None:
    manifest, preds = read_manifest(out), read_jsonl(out / "predictions.jsonl")
    info = (
        json.loads((out / "run_info.json").read_text())
        if (out / "run_info.json").exists()
        else None
    )
    (out / "coverage.md").write_text(report_text(manifest, preds, info), encoding="utf-8")
    kept = [r for r in manifest if r["excluded"] != "yes"]
    (out / "coverage.json").write_text(json.dumps({
        "kind": "coverage on real uploads, not accuracy", "n_unique": len(manifest),
        "n_excluded": len(manifest) - len(kept), "n_evaluated": len(preds), **coverage(preds),
    }, indent=2))  # fmt: skip
    print((out / "coverage.md").read_text())


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("cmd", choices=["triage", "rerun", "report"])
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--photos", type=Path, default=Path("data/scans/photos"))
    ap.add_argument("--db", type=Path, default=Path("data/scans/scans.sqlite3"))
    ap.add_argument("--device", default="cpu")
    a = ap.parse_args(argv)
    if a.cmd == "triage":
        triage(a.photos, a.db, a.out)
    elif a.cmd == "rerun":
        rerun(a.photos, a.out, a.device)
    else:
        report(a.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
