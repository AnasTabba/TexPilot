#!/usr/bin/env python3
"""Smoke-test TextileNet availability. Spec risk #2.

The TextileNet repo is from 2023 and its prepare_data.py re-scrapes images from
source URLs, so link rot is likely. Run this in week 1, before the training
pipeline depends on the data being there.

    make check-data
"""

from __future__ import annotations

import sys
import urllib.error
import urllib.request

REPO_FILES = {
    "labels/fabric_label.txt": "https://raw.githubusercontent.com/hahashu/TextileNet/main/labels/fabric_label.txt",
    "labels/fibre_label.txt": "https://raw.githubusercontent.com/hahashu/TextileNet/main/labels/fibre_label.txt",
    "prepare_data.py": "https://raw.githubusercontent.com/hahashu/TextileNet/main/prepare_data.py",
}

SEED_ZIPS = {
    "TextileNet-fibre (Google Drive)": "https://drive.google.com/file/d/1e_E9NeTs7qSuUzWszSkmK09jTHPQwdd6/view",
    "TextileNet-fabric (Google Drive)": "https://drive.google.com/file/d/1G_g3NEcluW9iKbWY6BiCMcSo0eLxCG0z/view",
}


def reachable(url: str, timeout: int = 15) -> tuple[bool, str]:
    try:
        req = urllib.request.Request(url, method="GET", headers={"User-Agent": "texpilot-check"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status == 200, str(resp.status)
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}"
    except Exception as e:  # noqa: BLE001 - diagnostic script
        return False, type(e).__name__


def main() -> int:
    failures = 0

    print("TextileNet repo files:")
    for name, url in REPO_FILES.items():
        ok, detail = reachable(url)
        print(f"  [{'ok' if ok else 'FAIL'}] {name}  ({detail})")
        failures += not ok

    print("\nSeed dataset zips (manual download -- these are Drive landing pages):")
    for name, url in SEED_ZIPS.items():
        print(f"  ->  {name}\n      {url}")

    print(
        "\nNOTE: reachable repo files do NOT mean the scraped image URLs inside\n"
        "prepare_data.py still resolve. Run it with --test --processes 4 against a\n"
        "scratch directory and count what actually downloads before trusting the set."
    )
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
