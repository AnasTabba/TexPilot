#!/usr/bin/env python3
"""Rebuild TextileNet on disk and freeze the split.

TextileNet = the Google Drive seed archives (already split into train/ and test/)
PLUS the images listed in the upstream ``json/<partition>_{train,test}.json``
manifests, which have to be scraped from their 2023 source URLs. The two sets are
disjoint. Link rot only hits the scraped half; see README "Open risks".

    python -m training.textilenet.prepare_data download --partition fabric
    python -m training.textilenet.prepare_data extract  --partition fabric
    python -m training.textilenet.prepare_data scrape   --partition fabric   # test first
    python -m training.textilenet.prepare_data index    --partition fabric

Layout (all under --data-root, default ./data, gitignored):

    raw/<partition>.tar.gz                     seed archive
    <partition>/{train,test}/<class>/*         extracted archive
    scraped/<partition>/{train,test}/<class>/* scraped manifest images
    scraped/<partition>/status.csv             one row per URL attempt (makes scrape resumable)
    splits/<partition>.csv                     THE split. Every experiment reads this.

``index`` is the only step that decides membership. Run it once and ship the CSV to
any other machine: re-scraping later recovers a different set of URLs, so a split
rebuilt elsewhere would not be the same split.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from pathlib import Path

from training.textilenet.splits import PARTITIONS, Record, build_split, write_csv

DRIVE_IDS = {
    "fabric": "1G_g3NEcluW9iKbWY6BiCMcSo0eLxCG0z",
    "fibre": "1e_E9NeTs7qSuUzWszSkmK09jTHPQwdd6",
}
MANIFEST_URL = "https://raw.githubusercontent.com/hahashu/TextileNet/main/json/{p}_{s}.json"
UA = {"User-Agent": "Mozilla/5.0 (TexPilot research; TextileNet rebuild)"}
IMAGE_MAGIC = (b"\xff\xd8\xff", b"\x89PNG", b"GIF8", b"RIFF", b"BM")
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}


# --------------------------------------------------------------------------- download


def cmd_download(args: argparse.Namespace) -> int:
    """Resumable Drive download. Drive resets long transfers; curl -C - picks up again."""
    out = args.data_root / "raw" / f"{args.partition}.tar.gz"
    out.parent.mkdir(parents=True, exist_ok=True)
    file_id = DRIVE_IDS[args.partition]
    for attempt in range(1, args.retries + 1):
        page = _get(f"https://drive.google.com/uc?export=download&id={file_id}", timeout=30)
        uuid = _between(page.decode(errors="ignore"), 'name="uuid" value="', '"') if page else None
        if not uuid:
            print(f"attempt {attempt}: Drive confirm page unreachable; retrying", flush=True)
            time.sleep(30)
            continue
        have = out.stat().st_size if out.exists() else 0
        print(f"attempt {attempt}: resuming {out.name} at {have / 1e9:.2f} GB", flush=True)
        url = (
            f"https://drive.usercontent.google.com/download?id={file_id}"
            f"&export=download&confirm=t&uuid={uuid}"
        )
        cmd = ["curl", "-sS", "-L", "-C", "-", "--speed-limit", "20000", "--speed-time", "60"]
        rc = subprocess.call([*cmd, "-o", str(out), url])
        if rc == 0 and subprocess.call(["gzip", "-t", str(out)]) == 0:
            print(f"{out} OK ({out.stat().st_size / 1e9:.2f} GB)")
            return 0
        time.sleep(30)
    print(f"{out}: gave up after {args.retries} attempts", file=sys.stderr)
    return 1


# ---------------------------------------------------------------------------- extract


def cmd_extract(args: argparse.Namespace) -> int:
    src = args.data_root / "raw" / f"{args.partition}.tar.gz"
    root = args.data_root / args.partition
    n = 0
    # Stream mode: one pass over a 12-14 GB gzip. Archive root is ./<partition>/{train,test}/.
    with tarfile.open(src, "r|gz") as tar:
        for m in tar:
            parts = Path(m.name).parts
            parts = parts[1:] if parts and parts[0] == "." else parts
            if not m.isfile() or Path(m.name).name.startswith("."):
                continue
            if len(parts) != 4 or parts[0] != args.partition or ".." in parts:
                print(f"skipping unexpected member {m.name}")
                continue
            m.name = "/".join(parts)  # normalised, relative, checked above
            tar.extract(m, args.data_root, set_attrs=False)
            n += 1
            if n % 20000 == 0:
                print(f"  {n} files", flush=True)
    for split in ("train", "test"):
        n = sum(1 for _ in (root / split).rglob("*") if _.is_file())
        print(f"{root / split}: {n} files")
    if args.delete_archive:
        src.unlink()
        print(f"deleted {src}")
    return 0


# ----------------------------------------------------------------------------- scrape


def cmd_scrape(args: argparse.Namespace) -> int:
    base = args.data_root / "scraped" / args.partition
    base.mkdir(parents=True, exist_ok=True)
    status_path = base / "status.csv"
    done = _load_status(status_path, retry_failed=args.retry_failed)

    lock = threading.Lock()
    abort = threading.Event()
    streak = [0]  # consecutive connection-level failures
    new_file = not status_path.exists()
    with open(status_path, "a", newline="") as fh:
        log = csv.writer(fh)
        if new_file:
            log.writerow(["split", "label", "fname", "status", "bytes", "url"])
        for split in args.splits:  # test first by default: it is what makes numbers comparable
            entries = _manifest(args.data_root, args.partition, split)
            todo = [e for e in entries if (split, e[1], e[0]) not in done][: args.limit or None]
            print(f"{split}: {len(entries)} in manifest, {len(todo)} to fetch", flush=True)

            def work(entry, split=split):
                if abort.is_set():
                    return "skipped"
                fname, label, url = entry
                status, size = _fetch_image(url, base / split / label / fname)
                with lock:
                    log.writerow([split, label, fname, status, size, url])
                    streak[0] = streak[0] + 1 if _is_network_error(status) else 0
                    if streak[0] >= args.abort_after:
                        abort.set()
                return status

            counts: dict[str, int] = {}
            t0 = time.time()
            with ThreadPoolExecutor(args.workers) as ex:
                for i, status in enumerate(ex.map(work, todo), 1):
                    counts[status] = counts.get(status, 0) + 1
                    if i % 2000 == 0 or i == len(todo):
                        fh.flush()
                        ok = counts.get("ok", 0)
                        rate = i / (time.time() - t0)
                        print(
                            f"  {split} {i}/{len(todo)} ok={ok} ({100 * ok / i:.0f}%) "
                            f"{rate:.0f}/s {counts}",
                            flush=True,
                        )
            if abort.is_set():
                print(
                    f"{args.abort_after} connection failures in a row: network looks down. "
                    "Stopped; rerun the same command to resume.",
                    file=sys.stderr,
                )
                return 3
    return 0


def _is_network_error(status: str) -> bool:
    """Connection-level failure (DNS, reset, timeout): says nothing about the URL itself."""
    return status not in ("ok", "not_image") and not status.startswith("http_")


def _fetch_image(url: str, dest: Path) -> tuple[str, int]:
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=20) as r:
            data = r.read()
    except urllib.error.HTTPError as e:
        return f"http_{e.code}", 0
    except Exception as e:  # noqa: BLE001 - every failure is a status, not a crash
        return type(e).__name__, 0
    if len(data) < 500 or not data.startswith(IMAGE_MAGIC):
        return "not_image", len(data)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    tmp.write_bytes(data)
    os.replace(tmp, dest)
    return "ok", len(data)


def _load_status(path: Path, retry_failed: bool) -> set[tuple[str, str, str]]:
    """URLs with a definite outcome. Connection errors are always retried on rerun."""
    if not path.exists():
        return set()
    with open(path, newline="") as f:
        return {
            (r["split"], r["label"], r["fname"])
            for r in csv.DictReader(f)
            if r["status"] == "ok" or not (retry_failed or _is_network_error(r["status"]))
        }


def _manifest(data_root: Path, partition: str, split: str) -> list[list[str]]:
    cache = data_root / "scraped" / "manifests" / f"{partition}_{split}.json"
    if not cache.exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        raw = _get(MANIFEST_URL.format(p=partition, s=split), timeout=120)
        if raw is None:
            raise SystemExit(f"cannot fetch manifest {partition}_{split}")
        cache.write_bytes(raw)
    return json.loads(cache.read_text())


# ------------------------------------------------------------------------------ index


def cmd_index(args: argparse.Namespace) -> int:
    out = args.data_root / "splits" / f"{args.partition}.csv"
    if out.exists() and not args.force:
        raise SystemExit(
            f"{out} exists and is frozen; runs already depend on it. --force rebuilds."
        )
    classes = set(PARTITIONS[args.partition])
    candidates: list[tuple[Path, str, str, str]] = []  # (abs path, label, split, source)
    trees = {
        "archive": args.data_root / args.partition,
        "scraped": args.data_root / "scraped" / args.partition,
    }
    unknown: set[str] = set()
    for source, root in trees.items():
        for split in ("train", "test"):
            if not (root / split).is_dir():
                print(f"note: {root / split} missing")
                continue
            for label_dir in sorted((root / split).iterdir()):
                if not label_dir.is_dir():
                    continue
                if label_dir.name not in classes:
                    unknown.add(label_dir.name)
                    continue
                for p in label_dir.iterdir():
                    if p.suffix.lower() in IMAGE_EXTS and not p.name.startswith("."):
                        candidates.append((p, label_dir.name, split, source))
    if unknown:
        raise SystemExit(f"class dirs not in the {args.partition} taxonomy: {sorted(unknown)}")

    print(f"hashing + decoding {len(candidates)} files on {os.cpu_count()} cores...", flush=True)
    with ProcessPoolExecutor() as ex:
        checked = list(ex.map(_hash_and_check, [c[0] for c in candidates], chunksize=256))

    records, bad = [], []
    for (p, label, split, source), (sha1, err) in zip(candidates, checked, strict=True):
        rel = p.relative_to(args.data_root).as_posix()
        if err:
            bad.append((rel, err))
        else:
            records.append(Record(rel, label, split, source, sha1))

    rows, stats = build_split(records, args.partition, val_frac=args.val_frac, seed=args.seed)
    stats["undecodable"] = len(bad)
    for source in trees:
        for split in ("train", "val", "test"):
            n = sum(r.split == split and r.source == source for r in rows)
            stats[f"n_{split}_{source}"] = n

    write_csv(rows, out)
    (out.with_suffix(".stats.json")).write_text(json.dumps(stats, indent=2))
    if bad:
        with open(out.with_suffix(".undecodable.csv"), "w", newline="") as f:
            csv.writer(f).writerows([("path", "error"), *bad])
    print(json.dumps(stats, indent=2))
    print(f"wrote {out}")
    return 0


def _hash_and_check(path: Path) -> tuple[str, str | None]:
    data = path.read_bytes()
    sha1 = hashlib.sha1(data).hexdigest()
    try:
        from PIL import Image, ImageFile

        ImageFile.LOAD_TRUNCATED_IMAGES = True
        with Image.open(path) as im:
            im.draft("RGB", (64, 64))  # JPEG: decode at 1/8 scale; enough to prove it decodes
            im.convert("RGB")
    except Exception as e:  # noqa: BLE001
        return sha1, f"{type(e).__name__}: {e}"[:200]
    return sha1, None


# ----------------------------------------------------------------------------- helpers


def _get(url: str, timeout: int) -> bytes | None:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
            return r.read()
    except Exception:  # noqa: BLE001
        return None


def _between(s: str, start: str, end: str) -> str | None:
    i = s.find(start)
    if i < 0:
        return None
    j = s.find(end, i + len(start))
    return s[i + len(start) : j] if j > 0 else None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p: argparse.ArgumentParser) -> None:
        p.add_argument("--partition", choices=sorted(PARTITIONS), required=True)
        p.add_argument("--data-root", type=Path, default=Path("data"))

    p = sub.add_parser("download", help="fetch the seed archive from Google Drive (resumable)")
    common(p)
    p.add_argument("--retries", type=int, default=300)

    p = sub.add_parser("extract", help="unpack the seed archive into <data-root>/<partition>")
    common(p)
    p.add_argument("--delete-archive", action="store_true", help="remove the .tar.gz afterwards")

    p = sub.add_parser("scrape", help="fetch manifest images from their source URLs (resumable)")
    common(p)
    p.add_argument("--splits", nargs="+", default=["test", "train"], choices=["test", "train"])
    p.add_argument("--workers", type=int, default=32)
    p.add_argument("--limit", type=int, default=0, help="max URLs per split (0 = all)")
    p.add_argument("--retry-failed", action="store_true", help="also re-attempt HTTP errors")
    p.add_argument(
        "--abort-after",
        type=int,
        default=100,
        help="stop after this many consecutive connection failures",
    )

    p = sub.add_parser("index", help="hash, verify and freeze the split CSV")
    common(p)
    p.add_argument("--val-frac", type=float, default=0.1)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--force", action="store_true", help="overwrite an existing split")

    args = ap.parse_args(argv)
    if shutil.which("curl") is None and args.cmd == "download":
        raise SystemExit("curl is required for download")
    return {
        "download": cmd_download,
        "extract": cmd_extract,
        "scrape": cmd_scrape,
        "index": cmd_index,
    }[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
