"""Write the printable TexPilot card sheet (A4 SVG, mm units): four cards to cut out, each the
ArUco marker services/vision/marker.py looks for, plus a ruler to check the print size.

.venv/bin/python scripts/make_card.py yarn-erp/public/texpilot-card.svg
"""

from __future__ import annotations

import sys
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.vision.marker import CARD_ID, MARKER_MM  # noqa: E402

BORDER_MM = 5.0  # white quiet zone the detector needs around the marker


def marker_rects(x: float, y: float) -> list[str]:
    d = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    bits = cv2.aruco.generateImageMarker(d, CARD_ID, 6)  # 4x4 cells + 1-cell black frame
    s = MARKER_MM / 6
    return [
        f'<rect x="{x + c * s:g}" y="{y + r * s:g}" width="{s:g}" height="{s:g}"/>'
        for r in range(6)
        for c in range(6)
        if bits[r, c] < 128
    ]


def sheet() -> str:
    card = MARKER_MM + 2 * BORDER_MM
    parts = []
    for i in range(4):
        cx, cy = 35 + (i % 2) * 85, 70 + (i // 2) * 85
        parts.append(
            f'<rect x="{cx:g}" y="{cy:g}" width="{card:g}" height="{card:g}" fill="none" '
            'stroke="#999" stroke-width="0.3" stroke-dasharray="2 1.5"/>'
        )
        parts += marker_rects(cx + BORDER_MM, cy + BORDER_MM)
    ruler = ['<line x1="35" y1="252" x2="135" y2="252" stroke="#000" stroke-width="0.4"/>']
    ruler += [
        f'<line x1="{35 + t:g}" y1="252" x2="{35 + t:g}" y2="{248 if t % 10 == 0 else 250:g}" '
        'stroke="#000" stroke-width="0.25"/>'
        for t in range(0, 101, 5)
    ]
    lines = [
        f"Each black square must measure {MARKER_MM:g} mm: check the ruler below (100 mm).",
        "Cut out one card along the dashed line and lay it flat on the fabric.",
        "Use the normal (1x) camera, straight above, about 15 cm away, selvedge running up",
        "the screen. Keep the card off the photo's edges; fill the rest with fabric.",
    ]
    words = [
        '<text x="20" y="20" font-size="4.6" font-weight="bold">TexPilot card: print at 100% '
        "(actual size, not &quot;fit to page&quot;)</text>",
        '<text x="33" y="247" font-size="3">0</text>',
        '<text x="128" y="247" font-size="3">100 mm</text>',
    ] + [f'<text x="20" y="{28 + 6 * i}" font-size="3.6">{t}</text>' for i, t in enumerate(lines)]
    body = "\n".join(parts + ruler + words)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" '
        'viewBox="0 0 210 297" font-family="Helvetica, Arial, sans-serif">\n'
        '<rect width="210" height="297" fill="#fff"/>\n'
        f"{body}\n</svg>\n"
    )


if __name__ == "__main__":
    Path(sys.argv[1]).write_text(sheet())
