"""Conservative single-label pattern targets for WHOLE photos, never garment crops.

Fashionpedia global attributes can include plain garments beside one printed garment:
plain is ignored when exactly one nonplain motif is visible. Photos with two distinct
motifs or an unsupported pattern are excluded. An absent attribute is never 'solid'.
"""
from __future__ import annotations

import hashlib
import re

PATTERNS = {
    'plain (pattern)': 'solid', 'abstract': 'abstract', 'cartoon': 'graphic',
    'letters, numbers': 'graphic', 'camouflage': 'camouflage', 'check': 'check',
    'dot': 'dot', 'fair isle': 'fair_isle', 'floral': 'floral', 'plant': 'floral',
    'geometric': 'geometric', 'paisley': 'paisley', 'stripe': 'stripe',
    'houndstooth (pattern)': 'houndstooth', 'herringbone (pattern)': 'herringbone',
    'chevron': 'chevron', 'argyle': 'argyle', 'toile de jouy': 'graphic',
}


def pattern_label(attribute_ids, attributes) -> str | None:
    lookup = {a['id']: a for a in attributes}
    labels = set()
    for ident in attribute_ids:
        a = lookup.get(ident)
        if a is None:
            continue
        parent = a['supercategory'].lower()
        if parent == 'animal':
            labels.add('animal')
        elif parent == 'textile pattern':
            label = PATTERNS.get(a['name'].lower())
            if label is None:
                return None
            labels.add(label)
    motifs = labels - {'solid'}
    return next(iter(motifs)) if len(motifs) == 1 else ('solid' if labels == {'solid'} else None)


def _split(key: str) -> str:
    h = int(hashlib.md5(key.encode()).hexdigest(), 16) % 100
    return 'train' if h < 70 else 'val' if h < 85 else 'test'


def product_split(store: str, product_id: str) -> str:
    """Matches the existing shop heads' product split, including all photos of a product."""
    return _split(store + product_id)


def fashion_rows(doc: dict, official_split: str) -> list[dict]:
    images = {im['id']: im for im in doc['images']}
    rows = []
    for ann in doc['annotations']:
        label = pattern_label(ann['attribute_ids'], doc['attributes'])
        if label is None:
            continue
        im = images[ann['image_id']]
        group = 'fashionpedia:' + im['file_name']
        rows.append(dict(path='fashionpedia/' + im['file_name'], label=label, group=group,
                         split=_split(group) if official_split == 'train' else 'official_test',
                         domain='fashionpedia', image_id=im['id'],
                         license=im.get('license'), original_url=im.get('original_url', '')))
    return rows


TITLE_RULES = {
    'solid': r'\b(solid|plain)\b', 'stripe': r'\bstrip(e|es|ed|ing)\b',
    'check': r'\b(check|checks|checked|checkered|plaid|gingham|tartan)\b',
    'floral': r'\b(floral|flower|flowers|botanical)\b',
    'dot': r'\bpolka\b|\bdott?ed\b|\bdots\b',
    'graphic': r'\b(graphic|graphics|cartoon|slogan|logo)\b',
    'animal': r'\banimal print\b|\b(leopard|zebra|snakeskin|cheetah|giraffe)\b',
    'camouflage': r'\b(camo|camouflage)\b', 'paisley': r'\bpaisley\b',
    'geometric': r'\bgeometric\b', 'abstract': r'\babstract\b',
    'houndstooth': r'\bhoundstooth\b', 'herringbone': r'\bherringbone\b',
    'chevron': r'\bchevron\b', 'argyle': r'\bargyle\b', 'fair_isle': r'\bfair[- ]isle\b',
}


def title_pattern(title: str) -> str | None:
    labels = {c for c, rule in TITLE_RULES.items() if re.search(rule, title.lower())}
    motifs = labels - {'solid'}
    return next(iter(motifs)) if len(motifs) == 1 else ('solid' if labels == {'solid'} else None)


def pattern_input(data: bytes, meta: dict):
    """Exact serving decode (upright, max1600px) plus whole-photo encoder preprocessing."""
    from services.vision.backbone import preprocess
    from services.vision.imageio import decode_image

    return preprocess(decode_image(data), meta['mean'], meta['std'],
                      meta['img_size'], meta['crop_pct'])


def shop_rows(manifest, classes, min_products: int = 20):
    """Only classes with enough distinct TRAIN products enter the shop-domain experiment."""
    from collections import Counter

    rows = []
    for r in manifest:
        label = title_pattern(r['title'])
        if label in classes:
            rows.append(dict(path='shops/' + r['path'], label=label,
                             split=product_split(r['store'], r['product_id']), domain='shop',
                             group='shop:' + r['store'] + ':' + r['product_id']))
    products = {(r['label'], r['group']) for r in rows if r['split'] == 'train'}
    counts = Counter(c for c, _ in products)
    return [r for r in rows if counts[r['label']] >= min_products], dict(counts)
