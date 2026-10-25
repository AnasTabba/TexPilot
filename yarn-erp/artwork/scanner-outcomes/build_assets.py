"""Extract generated atlases and export the scanner's gentle 4.2-second float loop.

Run from the repository root with Python and Pillow. Sources are preserved verbatim.
These illustrations are reference artwork, never prediction evidence.
"""

from __future__ import annotations

import json
import math
import sys
from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
BATCHES = [
    'canvas chambray chenille chiffon corduroy crepe faux_fur faux_leather flannel fleece gingham jersey knit lace lawn neoprene'.split(),
    'organza plush satin serge taffeta tulle tweed twill velvet vinyl cellulosic protein synthetic blend printed piece_dyed'.split(),
    'yarn_dyed undyed shirt_blouse sweater cardigan vest shorts skirt coat dress jumpsuit cape scarf pass flag insufficient_evidence'.split(),
]


def subject_crop(cell: Image.Image) -> Image.Image:
    """Extract the main atlas subject, excluding neighboring-cell edge fragments."""
    alpha = cell.getchannel('A')
    width, height = cell.size
    occupied = bytearray(1 if a > 24 else 0 for a in alpha.tobytes())
    largest, bounds = 0, (0, 0, width, height)
    for start in range(len(occupied)):
        if not occupied[start]:
            continue
        queue = deque([start])
        occupied[start] = 0
        count, x0, y0, x1, y1 = 0, width, height, 0, 0
        while queue:
            i = queue.popleft()
            x, y = i % width, i // width
            count += 1
            x0, y0, x1, y1 = min(x0, x), min(y0, y), max(x1, x), max(y1, y)
            for neighbor in (i - width if y else -1, i + width if y + 1 < height else -1,
                             i - 1 if x else -1, i + 1 if x + 1 < width else -1):
                if neighbor >= 0 and occupied[neighbor]:
                    occupied[neighbor] = 0
                    queue.append(neighbor)
        if count > largest:
            largest, bounds = count, (max(0, x0 - 1), max(0, y0 - 1), min(width, x1 + 2), min(height, y1 + 2))
    return cell.crop(bounds)


def normalize(source: Image.Image, size: int, ratio: float) -> Image.Image:
    source = source.convert('RGBA')
    bounds = source.getchannel('A').getbbox()
    if not bounds:
        raise ValueError('Empty illustration')
    source = source.crop(bounds)
    scale = size * ratio / max(source.size)
    source = source.resize((round(source.width * scale), round(source.height * scale)), Image.Resampling.LANCZOS)
    frame = Image.new('RGBA', (size, size))
    frame.alpha_composite(source, ((size - source.width) // 2, (size - source.height) // 2))
    return frame


def export(name: str, source: Image.Image, generated: bool) -> dict:
    still = normalize(source, 512, 0.73)
    still.save(ROOT / 'still' / f'{name}.webp', quality=92, method=1)
    if '--skip-existing' in sys.argv and (ROOT / 'animated' / f'{name}.webp').exists():
        return {'id': name, 'label': name.replace('_', ' ').title(),
                'still': f'still/{name}.webp', 'animated': f'animated/{name}.webp',
                'generated': generated}
    base = normalize(source, 256, 0.73)
    frames = []
    for i in range(35):
        # Matches fabric-float: settle -> rise 10px/rotate 4deg -> settle.
        rise = (1 - math.cos(2 * math.pi * i / 35)) / 2
        frame = Image.new('RGBA', (256, 256))
        rotated = base.rotate(-12 + 4 * rise, Image.Resampling.BICUBIC)
        frame.alpha_composite(rotated, (0, -round(6 * rise)))
        frames.append(frame)
    frames[0].save(
        ROOT / 'animated' / f'{name}.webp', save_all=True,
        append_images=frames[1:], duration=120, loop=0,
        quality=82, method=1, minimize_size=True,
    )
    return {
        'id': name, 'label': name.replace('_', ' ').title(),
        'still': f'still/{name}.webp', 'animated': f'animated/{name}.webp',
        'generated': generated,
    }


def main() -> None:
    for folder in ('still', 'animated'):
        (ROOT / folder).mkdir(exist_ok=True)
    assets = {}
    for n, names in enumerate(BATCHES, 1):
        sheet = Image.open(ROOT / 'sources' / f'atlas-{n}.png').convert('RGBA')
        for i, name in enumerate(names):
            x, y = i % 4, i // 4
            crop = sheet.crop((round(x * sheet.width / 4), round(y * sheet.height / 4),
                               round((x + 1) * sheet.width / 4), round((y + 1) * sheet.height / 4)))
            assets[name] = export(name, subject_crop(crop), True)
    assets['uncertain'] = export('uncertain', Image.open(ROOT / 'sources' / 'uncertain.png'), True)
    for name in ('denim', 'cotton', 'polyester'):
        assets[name] = export(name, Image.open(REPO / 'yarn-erp' / 'src' / 'assets' / 'fabrics' / f'{name}.webp'), False)

    from services.vision.taxonomy import FABRIC_CLASSES, FIBRE_FAMILIES, TREATMENT_CLASSES
    from services.vision.garment import GARMENT_VOCAB
    from services.api.schemas import Outcome

    groups = {
        'Fabric': {name: name for name in FABRIC_CLASSES},
        'Fibre family': {name: name for name in FIBRE_FAMILIES},
        'Treatment': {name: name for name in TREATMENT_CLASSES},
        'Garment': {name: {'top_tshirt_sweatshirt': 'cotton', 'pants': 'denim', 'jacket': 'polyester'}.get(name, name) for name in GARMENT_VOCAB},
        'Verification': {item.value: item.value.lower() for item in Outcome},
        'Uncertain detection': {'uncertain': 'uncertain'},
    }
    assert all(asset in assets for mapping in groups.values() for asset in mapping.values())
    manifest = {
        'description': 'Illustrative artwork only; never scanner evidence. Exact fibre composition comes from the care label.',
        'motion': {'duration_ms': 4200, 'timeline_frames': 35, 'frame_duration_ms': 120, 'loop': 'infinite'},
        'notes': {'blend': 'Defined family; not currently trained.'},
        'groups': groups, 'assets': assets,
    }
    (ROOT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    names = [f'## {group}\n\n' + ', '.join(name.replace('_', ' ') for name in mapping) for group, mapping in groups.items()]
    (ROOT / 'OUTCOMES.md').write_text('# Scanner outcome artwork\n\n' + '\n\n'.join(names) + '\n')
    gallery = (ROOT / 'gallery-template.html').read_text().replace('__MANIFEST__', json.dumps(manifest))
    (ROOT / 'index.html').write_text(gallery)
    print(f'Exported {len(assets)} assets ({sum(a["generated"] for a in assets.values())} new); {sum(map(len, groups.values()))} covered outcomes.')


if __name__ == '__main__':
    main()
