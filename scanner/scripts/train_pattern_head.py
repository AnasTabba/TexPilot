"""Kaggle-only v8 whole-photo pattern extraction, val selection and held-out reporting.

The output is a standard models/custom/pattern head: no additional encoder pass.
Official Fashionpedia val remains a separately reported test; shop splits by product.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
import tarfile
import time
from collections import Counter
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from training.scanner.pattern_data import pattern_input, shop_rows  # noqa: E402
from training.scanner.pattern_head import select_head  # noqa: E402


def main():
    import timm
    import torch
    from PIL import ImageFile
    from safetensors import safe_open
    from safetensors.numpy import save_file
    from safetensors.torch import load_file
    from sklearn.metrics import f1_score
    from torch.utils.data import DataLoader, Dataset

    from services.vision.backbone import pool_features
    from services.vision.heads import softmax
    from training.scanner.calibration import abstain_threshold, fit_temperature
    from training.textilenet.recipe import apply_lora

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--fashion-dir', type=Path, required=True)
    ap.add_argument('--shops-dir', type=Path, required=True)
    ap.add_argument('--adapters-dir', type=Path, required=True)
    ap.add_argument('--out', type=Path, required=True)
    args = ap.parse_args()
    if not torch.cuda.is_available():
        raise RuntimeError('Heavy pattern feature extraction must run on Kaggle CUDA')
    torch.set_num_threads(4)
    args.out.mkdir(parents=True, exist_ok=True)
    root = Path('/tmp/pattern-images')
    root.mkdir(parents=True, exist_ok=True)
    rows = list(csv.DictReader((args.fashion_dir / 'fashionpedia_patterns.csv').open()))
    classes = sorted({r['label'] for r in rows if r['split'] == 'train'})
    # Read only labelled shop products; a title saying merely 'printed' has no pattern label.
    shop, shop_support = shop_rows(
        csv.DictReader((args.shops_dir / 'all_manifest.csv').open()), classes, min_products=20)
    print('shop TRAIN product support', shop_support, 'included photos', len(shop), flush=True)
    wanted = {r['path'] for r in rows + shop}
    # Preserve whole original photos and write only the selected files under a safe root.
    sources = [(args.fashion_dir / 'fashionpedia_patterns.tar', '')]
    sources += [(p, 'shops/') for p in sorted(args.shops_dir.glob('*.tar'))]
    for path, prefix in sources:
        count = 0
        with tarfile.open(path) as archive:
            for member in archive:
                rel = prefix + member.name.removeprefix('./')
                if rel not in wanted or not member.isfile():
                    continue
                dest = root / rel
                if not dest.resolve().is_relative_to(root.resolve()):
                    raise ValueError('Unsafe archive path')
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(archive.extractfile(member).read())
                count += 1
        print('extracted', path.name, count, flush=True)
    all_rows = rows + shop
    missing = [r['path'] for r in all_rows if not (root / r['path']).exists()]
    if missing:
        raise FileNotFoundError(f'{len(missing)} selected images missing: {missing[:3]}')
    # Exact duplicates across products/domains are kept only in the held-out-first split.
    order = {'official_test': 0, 'test': 1, 'val': 2, 'train': 3}
    seen, rows, duplicates = set(), [], 0
    for r in sorted(all_rows, key=lambda r: (order[r['split']], r['path'])):
        digest = hashlib.sha256((root / r['path']).read_bytes()).hexdigest()
        if digest in seen:
            duplicates += 1
            continue
        seen.add(digest)
        rows.append(r)
    print('counts', Counter((r['domain'], r['split']) for r in rows), 'classes', classes,
          'duplicate photos excluded', duplicates, flush=True)
    head = json.loads((args.adapters_dir / 'v8_head.json').read_text())
    lora_path = args.adapters_dir / 'v8_lora.safetensors'
    enc_id = head['timm_name'] + '+lora-' + hashlib.sha256(lora_path.read_bytes()).hexdigest()[:8]
    assert enc_id == head['encoder_id'], (enc_id, head['encoder_id'])
    model = timm.create_model(head['timm_name'], pretrained=True, num_classes=0,
                              img_size=head['img_size'])
    with safe_open(str(lora_path), 'pt') as f:
        scale = float(f.metadata()['scale'])
    model.load_state_dict(apply_lora(model.state_dict(), load_file(str(lora_path)), scale))
    model = model.eval().half().cuda()
    ImageFile.LOAD_TRUNCATED_IMAGES = True

    class Photos(Dataset):
        def __len__(self):
            return len(rows)

        def __getitem__(self, i):
            return torch.from_numpy(pattern_input((root / rows[i]['path']).read_bytes(), head))

    features, started, half = [], time.time(), True
    with torch.no_grad():
        for i, x in enumerate(DataLoader(Photos(), batch_size=64, num_workers=4)):
            x = x.cuda()
            f = pool_features(model, x.half() if half else x.float()).float()
            if not torch.isfinite(f).all():
                print('nonfinite fp16: repeat batch and remaining extraction in fp32', flush=True)
                half = False
                model.float()
                f = pool_features(model, x.float()).float()
            if not torch.isfinite(f).all():
                raise ValueError('Nonfinite encoder features')
            features.append(f.cpu().numpy())
            if i % 100 == 0:
                print('features', min((i + 1) * 64, len(rows)), '/', len(rows),
                      'seconds', round(time.time() - started), flush=True)
    x = np.concatenate(features)
    del model, features
    torch.cuda.empty_cache()
    y = np.array([classes.index(r['label']) for r in rows])
    split = np.array([r['split'] for r in rows])
    domains = np.array([r['domain'] for r in rows])
    np.savez_compressed(args.out / 'pattern_features.npz', x=x.astype(np.float16), y=y,
                        split=split, domains=domains)
    (args.out / 'pattern_manifest.json').write_text(json.dumps(rows))
    best, grid = select_head(x, y, split, domains, classes)
    w, b = best.pop('weight'), best.pop('bias')
    va = split == 'val'
    t = fit_temperature(x[va] @ w.T + b, y[va])
    w, b = w / t, b / t
    thresholds = {}
    for domain in sorted(set(domains)):
        m = va & (domains == domain)
        p = softmax(x[m] @ w.T + b)
        thresholds[domain] = abstain_threshold(p.max(1), p.argmax(1) == y[m], .90)[0]
    threshold = float(max(thresholds.values()))
    report = dict(classes=classes, selection=best, grid=grid, temperature=t,
                  threshold=threshold, domain_thresholds=thresholds,
                  encoder=enc_id, views='whole photo; standard v8 preprocessing',
                  domain='Fashionpedia attributes + shop title labels; no factory-phone test',
                  duplicates_excluded=duplicates, shop_train_products=shop_support,
                  shop_min_train_products=20, evaluations={})
    for domain in sorted(set(domains)):
        supported = np.unique(y[(split == 'train') & (domains == domain)])
        for s in ('val', 'test', 'official_test'):
            m = (split == s) & (domains == domain)
            if not m.any():
                continue
            p = softmax(x[m] @ w.T + b)
            pred, conf = p.argmax(1), p.max(1)
            kept, right = conf >= threshold, pred == y[m]
            per_class = f1_score(y[m], pred, labels=supported, average=None, zero_division=0)
            majority = Counter(y[(split == 'train') & (domains == domain)]).most_common(1)[0][0]
            rep = dict(n=int(m.sum()), macro_f1=float(np.mean(per_class)),
                       top1=float(right.mean()), answered=float(kept.mean()),
                       right_when_answering=float(right[kept].mean()) if kept.any() else None,
                       class_support={c: int((y[m] == i).sum()) for i, c in enumerate(classes)},
                       per_class_f1={classes[i]: float(f)
                                     for i, f in zip(supported, per_class, strict=True)},
                       majority_top1=float((y[m] == majority).mean()),
                       majority_macro_f1=float(f1_score(y[m], np.full(m.sum(), majority),
                                                        labels=supported, average='macro',
                                                        zero_division=0)))
            report['evaluations'][f'{domain}/{s}'] = rep
            print(domain, s, json.dumps(rep), flush=True)
    # Fixed before seeing results: useful macro F1 and nontrivial reliable answers in both domains.
    report['promotion_gate'] = dict(min_test_macro_f1=.50, min_test_answered=.05,
                                    min_test_answer_precision=.85, macro_gain_over_majority=.10)
    report['passes_gate'] = all(
        (r['macro_f1'] >= .50 and r['macro_f1'] >= r['majority_macro_f1'] + .10
         and r['answered'] >= .05 and (r['right_when_answering'] or 0) >= .85)
        for r in (report['evaluations'][f'{d}/test'] for d in sorted(set(domains))))
    out = args.out / 'custom' / 'pattern'
    out.mkdir(parents=True, exist_ok=True)
    save_file(dict(weight=w.astype(np.float32), bias=b.astype(np.float32)),
              str(out / 'head.safetensors'))
    (out / 'head.json').write_text(json.dumps(dict(classes=classes, threshold=threshold,
                                                 encoder=enc_id, report=report), indent=1))
    (args.out / 'pattern_results.json').write_text(json.dumps(report, indent=1))
    print('PASSES PREDECLARED GATE:', report['passes_gate'], flush=True)


if __name__ == '__main__':
    main()
