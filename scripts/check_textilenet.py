#!/usr/bin/env python3
"""Measure TextileNet availability. Spec risk #2.

TextileNet ships a seed zip plus `prepare_data.py`, which re-scrapes the rest of
the images from their original source URLs. The repo is from 2023 and ~73% of
those URLs point at contestimg.wish.com, so link rot is the dominant risk to the
training set. This script measures it instead of assuming.

    make check-data              # sample 60 URLs
    make check-data ARGS="-n 300"

Measured 2026-09-20: fabric ~37-45% of sampled URLs usable, fibre ~65%.
Rates vary by sample; the direction does not. See README "Open risks".
"""

from __future__ import annotations

import argparse
import collections
import json
import random
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

RAW = "https://raw.githubusercontent.com/hahashu/TextileNet/main"
MANIFESTS = {
    "fabric_test": f"{RAW}/json/fabric_test.json",
    "fibre_test": f"{RAW}/json/fibre_test.json",
}
SEED_ZIPS = {
    "TextileNet-fibre  (Google Drive)": "https://drive.google.com/file/d/1e_E9NeTs7qSuUzWszSkmK09jTHPQwdd6/view",
    "TextileNet-fabric (Google Drive)": "https://drive.google.com/file/d/1G_g3NEcluW9iKbWY6BiCMcSo0eLxCG0z/view",
}
UA = {"User-Agent": "Mozilla/5.0"}


def fetch(url: str, timeout: int = 20) -> bytes | None:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
            return r.read()
    except Exception:
        return None


def probe(url: str) -> tuple[object, int]:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=12) as r:
            return r.status, len(r.read(2048))
    except urllib.error.HTTPError as e:
        return e.code, 0
    except Exception as e:  # noqa: BLE001 - diagnostic script
        return type(e).__name__, 0


def sample_manifest(name: str, url: str, n: int) -> float | None:
    raw = fetch(url)
    if raw is None:
        print(f"  {name}: manifest UNREACHABLE")
        return None

    entries = json.loads(raw)
    hosts = collections.Counter(u.split("/")[2] for *_, u in entries)
    print(f"  {name}: {len(entries)} entries; top host {hosts.most_common(1)[0]}")

    random.seed(7)  # fixed, so reruns are comparable
    picks = random.sample(entries, min(n, len(entries)))
    with ThreadPoolExecutor(max_workers=12) as ex:
        results = list(ex.map(lambda rec: probe(rec[2]), picks))

    codes = collections.Counter(c for c, _ in results)
    usable = sum(1 for c, size in results if c == 200 and size > 500)
    pct = 100 * usable / len(picks)
    print(f"    sampled {len(picks)}: " + ", ".join(f"{n_}x{c}" for c, n_ in codes.most_common()))
    print(f"    usable: {usable}/{len(picks)} ({pct:.0f}%)")
    return pct


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("-n", type=int, default=60, help="URLs to sample per manifest")
    args = ap.parse_args()

    print("Scrape-target link rot:")
    measured = (sample_manifest(k, v, args.n) for k, v in MANIFESTS.items())
    rates = [r for r in measured if r is not None]

    print("\nSeed zips (self-contained; the real fallback):")
    for name, url in SEED_ZIPS.items():
        ok = fetch(url, timeout=15) is not None
        print(f"  [{'ok' if ok else 'FAIL'}] {name}\n      {url}")
    print("  NOTE: the UCL OneDrive mirrors in the TextileNet README return 403 and are dead.")
    print("  Download the Drive zips with `pip install gdown && gdown <id>` -- large-file")
    print("  downloads need the confirm token that a plain curl will not send.")

    if rates and max(rates) < 60:
        print(
            f"\nVERDICT: scraping recovers only ~{max(rates):.0f}% of images. Treat the seed\n"
            "zips as the dataset and plan the training set around them; do not assume\n"
            "prepare_data.py will rebuild the published corpus."
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
