"""Layout probe for Kaggle /kaggle/input datasets.

CPU-only, standard library + PIL, no network, reads headers only (nothing extracted).
Prints to stdout and writes the same text to --out.
"""

import argparse
import os
import sys
import traceback
import zipfile
from collections import Counter

from PIL import Image

MAX_LINES = 4000  # hard guard on total output
MAX_DIR_LINES = 300  # directory lines per dataset
MAX_TREE_DEPTH = 3
MAX_EXAMPLES = 5
MAX_TEXT_SAMPLES = 40
MAX_TEXT_BYTES = 2 * 1024 * 1024
TEXT_EXTS = {".json", ".xml", ".txt", ".csv", ".yaml"}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".gif", ".webp"}
IMAGE_SAMPLES = 3
MAX_ZIPS = 10  # zips listed per dataset (zip count still reported)
MAX_ZIP_NAMES = 15
MAX_LINE_CHARS = 300
HEAD_LINES = 3


class Out:
    """Collects output lines, echoes them to stdout, enforces the line guard."""

    def __init__(self) -> None:
        self.lines: list[str] = []
        self.capped = False

    def emit(self, text: str = "") -> None:
        if self.capped:
            return
        if len(self.lines) >= MAX_LINES:
            self.capped = True
            self._store(f"[output capped at {MAX_LINES} lines; the rest is not printed]")
            return
        self._store(text)

    def _store(self, text: str) -> None:
        self.lines.append(text)
        print(text, flush=True)


def read_head(path: str, n: int) -> list[str]:
    lines = []
    with open(path, encoding="utf-8", errors="replace") as fh:
        for _ in range(n):
            line = fh.readline()
            if not line:
                break
            lines.append(line.rstrip("\r\n")[:MAX_LINE_CHARS])
    return lines


def probe_dataset(path: str, name: str, out: Out) -> None:
    # One full walk: per-directory entries, totals, and the sample lists.
    dirs: dict[str, list[tuple[str, str]]] = {}  # rel dir -> [(file name, ext)]
    total_files = 0
    total_bytes = 0
    text_samples: list[tuple[str, int]] = []
    zips: list[tuple[str, int]] = []
    zip_total = 0
    images: list[str] = []

    for dirpath, dirnames, filenames in os.walk(path, followlinks=False):
        dirnames.sort()
        rel = os.path.relpath(dirpath, path)
        entries = dirs.setdefault(rel, [])
        for fname in sorted(filenames):
            full = os.path.join(dirpath, fname)
            try:
                size = os.path.getsize(full)
            except OSError:
                size = 0
            ext = os.path.splitext(fname)[1].lower()
            entries.append((fname, ext))
            total_files += 1
            total_bytes += size
            if ext in TEXT_EXTS and size < MAX_TEXT_BYTES and len(text_samples) < MAX_TEXT_SAMPLES:
                text_samples.append((full, size))
            if ext == ".zip":
                zip_total += 1
                if len(zips) < MAX_ZIPS:
                    zips.append((full, size))
            if ext in IMAGE_EXTS and len(images) < IMAGE_SAMPLES:
                images.append(full)

    out.emit(f"== dataset: {name}  ({path})")

    # Directory tree, depth 0 (dataset root) to MAX_TREE_DEPTH.
    tree_rels = [r for r in dirs if r == "." or r.count(os.sep) + 1 <= MAX_TREE_DEPTH]
    shown = 0
    for rel in tree_rels:
        if shown >= MAX_DIR_LINES:
            break
        depth = 0 if rel == "." else rel.count(os.sep) + 1
        entries = dirs[rel]
        ext_counts = Counter(ext or "(no ext)" for _, ext in entries)
        ext_str = ", ".join(f"{e}:{c}" for e, c in sorted(ext_counts.items()))
        examples = sorted(fname for fname, _ in entries)[:MAX_EXAMPLES]
        label = name if rel == "." else os.path.basename(rel)
        out.emit(
            f"{'  ' * depth}{label}/  files={len(entries)}  ext[{ext_str}]  e.g. {examples}"
        )
        shown += 1
    if len(tree_rels) > shown:
        out.emit(
            f"  [directory listing capped at {MAX_DIR_LINES}; "
            f"{len(tree_rels) - shown} more directories not shown]"
        )

    out.emit(f"-- text samples: {len(text_samples)} (first {MAX_TEXT_SAMPLES} files "
             f"<2 MB with ext {sorted(TEXT_EXTS)})")
    for full, size in text_samples:
        out.emit(f"  {full}  size={size}")
        try:
            head = read_head(full, HEAD_LINES)
            if not head:
                out.emit("    (empty file)")
            for line in head:
                out.emit(f"    | {line}")
        except (OSError, ValueError) as exc:
            out.emit(f"    ERROR reading: {type(exc).__name__}: {exc}")

    out.emit(f"-- zip files: {zip_total} found, listing {len(zips)}")
    for full, size in zips:
        try:
            with zipfile.ZipFile(full) as zf:
                names = zf.namelist()
            out.emit(f"  {full}  size={size}  entries={len(names)}")
            for entry in names[:MAX_ZIP_NAMES]:
                out.emit(f"    {entry}")
        except (zipfile.BadZipFile, OSError) as exc:
            out.emit(f"  {full}  size={size}  ERROR {type(exc).__name__}: {exc}")

    out.emit(f"-- image samples: {len(images)}")
    for full in images:
        try:
            with Image.open(full) as im:
                w, h = im.size
                out.emit(f"  {full}  mode={im.mode}  size={w}x{h}")
        except Exception as exc:  # PIL raises many types for bad images
            out.emit(f"  {full}  ERROR {type(exc).__name__}: {exc}")

    out.emit(f"-- totals: files={total_files}  size={total_bytes / 1e9:.3f} GB")


def write_out(out: Out, path: str) -> None:
    try:
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("\n".join(out.lines) + "\n")
    except OSError as exc:
        print(f"ERROR writing {path}: {exc}", file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Print the layout of each dataset under root.")
    ap.add_argument("root", nargs="?", default="/kaggle/input")
    ap.add_argument("--out", default="/kaggle/working/layout.txt")
    args = ap.parse_args(argv)

    out = Out()
    try:
        if not os.path.isdir(args.root):
            out.emit(f"ERROR: root is not a directory: {args.root}")
            return 1
        names = sorted(os.listdir(args.root))
        datasets = [n for n in names if os.path.isdir(os.path.join(args.root, n))]
        out.emit(f"root={args.root}  folders={len(datasets)}")
        for name in datasets:
            try:
                probe_dataset(os.path.join(args.root, name), name, out)
            except Exception as exc:  # one bad dataset must not stop the run
                out.emit(f"ERROR in dataset {name}: {type(exc).__name__}: {exc}")
                for line in traceback.format_exc().splitlines():
                    out.emit(f"    {line}")
        return 0
    finally:
        write_out(out, args.out)


if __name__ == "__main__":
    sys.exit(main())
