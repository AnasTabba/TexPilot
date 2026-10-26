"""Kaggle CPU-only preparation of original Fashionpedia whole-photo pattern data.

Downloads from CVDF into /tmp, preserves selected original image bytes in one tar,
records image licenses/URLs and content hashes, and excludes byte duplicates across splits.
Only training support chooses classes (>=150 photos); training is capped at 5000/class.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
import tarfile
import urllib.request
import zipfile
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from training.scanner.pattern_data import fashion_rows  # noqa: E402

BASE = 'https://s3.amazonaws.com/ifashionist-dataset/'


def download(url, path):
    if path.exists():
        return
    tmp = path.with_suffix(path.suffix + '.part')
    print('downloading', url, flush=True)
    for attempt in range(3):
        try:
            urllib.request.urlretrieve(url, tmp)
            tmp.rename(path)
            return
        except Exception:
            if attempt == 2:
                raise
    raise RuntimeError(url)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--out', type=Path, required=True)
    ap.add_argument('--work', type=Path, default=Path('/tmp/fashionpedia'))
    args = ap.parse_args()
    args.work.mkdir(parents=True, exist_ok=True)
    args.out.mkdir(parents=True, exist_ok=True)
    rows = []
    for split in ('train', 'val'):
        path = args.work / f'attributes_{split}2020.json'
        download(BASE + 'annotations/' + path.name, path)
        doc = json.loads(path.read_text())
        selected = fashion_rows(doc, split)
        print(split, len(doc['images']), 'images;', len(selected), 'unambiguous pattern labels',
              Counter(r['label'] for r in selected), flush=True)
        rows.extend(dict(r, archive='train2020.zip' if split == 'train' else 'val_test2020.zip')
                    for r in selected)
        (args.out / f'{split}_sources.json').write_text(json.dumps({
            'info': doc.get('info'), 'licenses': doc.get('licenses'),
            'attributes': doc['attributes'], 'source': BASE + 'annotations/' + path.name,
        }, indent=1))
    counts = Counter(r['label'] for r in rows if r['split'] == 'train')
    classes = sorted(c for c, n in counts.items() if n >= 150)
    rows = [r for r in rows if r['label'] in classes]
    # The cap is deterministic, uses train only and does not alter either held-out set.
    used = Counter()
    selected = []
    for r in sorted(rows, key=lambda r: hashlib.sha256(r['path'].encode()).hexdigest()):
        if r['split'] == 'train':
            if used[r['label']] >= 5000:
                continue
            used[r['label']] += 1
        selected.append(r)
    archives = {}
    for archive in sorted({r['archive'] for r in selected}):
        path = args.work / archive
        download(BASE + 'images/' + archive, path)
        z = zipfile.ZipFile(path)
        archives[archive] = (z, {Path(n).name: n for n in z.namelist() if not n.endswith('/')})
    # Prefer retaining held-out photos over duplicate training copies.
    order = {'official_test': 0, 'test': 1, 'val': 2, 'train': 3}
    seen, final, duplicates = set(), [], 0
    with tarfile.open(args.out / 'fashionpedia_patterns.tar', 'w') as out:
        for r in sorted(selected, key=lambda r: (order[r['split']], r['path'])):
            z, names = archives[r['archive']]
            name = names.get(Path(r['path']).name)
            if name is None:
                raise FileNotFoundError(r['path'])
            raw = z.read(name)
            digest = hashlib.sha256(raw).hexdigest()
            if digest in seen:
                duplicates += 1
                continue
            seen.add(digest)
            import io
            info = tarfile.TarInfo(r['path'])
            info.size = len(raw)
            out.addfile(info, io.BytesIO(raw))
            final.append({k: v for k, v in r.items() if k != 'archive'} | {'sha256': digest})
    with (args.out / 'fashionpedia_patterns.csv').open('w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(final[0]))
        w.writeheader()
        w.writerows(final)
    report = dict(classes=classes, train_support_before_cap=dict(counts),
                  counts={s: dict(Counter(r['label'] for r in final if r['split'] == s))
                          for s in order}, duplicates_excluded=duplicates,
                  views='whole photo; scanner centre resize/crop only; no garment crops',
                  label_policy='one nonplain motif (+plain allowed), or explicit plain only',
                  source='https://github.com/cvdfoundation/fashionpedia',
                  image_license='per-image original license and URL in manifest; '
                                'not uniformly CC BY 4')
    (args.out / 'pattern_data_report.json').write_text(json.dumps(report, indent=1))
    print(json.dumps(report, indent=1), flush=True)


if __name__ == '__main__':
    main()
