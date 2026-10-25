"""Labelled photos from clothing shops, for the fibre and fabric heads. Shopify stores publish their
catalogue at /products.json; for each product we keep the composition its description states
(parsed strictly, as on a care label: an unclear one is dropped, never guessed), the blend name a
yarn buyer uses (CVC, PC, stretch, pure) and any fabric name in its title, then a few of its photos
at 640 px from the shop's image CDN.

Polite by design: an honest User-Agent, robots.txt obeyed, about one request per second per store.
Sites that refuse automated access are skipped, never worked around.

    python -m training.textilenet.shop_scrape --stores outfitters.com.pk rastah.co --out data/shops
"""

from __future__ import annotations

import argparse
import csv
import html
import io
import json
import re
import sys
import threading
import time
import urllib.request
import urllib.robotparser
from pathlib import Path

from services.ocr.parser import parse_composition

UA = "TexPilot-research/0.1 (+https://github.com/AnasTabba/TexPilot)"
# Fabric names shops use in titles: TextileNet's classes plus the local ones it lacks.
FABRICS = (
    "lawn", "khaddar", "khadar", "cambric", "karandi", "marina", "linen", "chiffon", "organza",
    "velvet", "denim", "jersey", "fleece", "twill", "corduroy", "poplin", "voile", "jacquard",
    "satin", "silk", "crepe", "georgette", "net", "slub", "wash & wear", "wash and wear",
    "pique", "terry", "chambray", "flannel", "tweed", "knit", "canvas", "leather",
)  # fmt: skip
_OTHER_PART = re.compile(
    r"\b(lining|pocket(ing)?|trim|rib|contrast|filling|padding|insole)\b", re.I
)


def composition(text: str) -> list[tuple[str, float]] | None:
    """The main composition a description states: the whole text if it parses, else the first
    sentence that does and is not about a lining, trim or pocket."""
    whole = parse_composition(text)
    if whole:
        return [(f.name, f.pct) for f in whole]
    for part in re.split(r"[.;\n|]|(?=\b(?:lining|pocket|trim)\b)", text, flags=re.I):
        if _OTHER_PART.search(part):
            continue
        got = parse_composition(part)
        if got:
            return [(f.name, f.pct) for f in got]
    return None


def blend(fibres: list[tuple[str, float]]) -> str:
    """CVC (cotton-rich cotton/poly), PC (poly-rich), stretch (has spandex), pure (one fibre)."""
    pct = dict(fibres)
    cotton, poly = pct.get("cotton", 0.0), pct.get("polyester", 0.0)
    if cotton and poly:
        return "CVC" if cotton >= poly else "PC"
    if pct.get("elastane_spandex"):
        return "stretch"
    return "pure" if max(pct.values()) >= 95 else "blend"


def label(product: dict) -> dict | None:
    text = html.unescape(re.sub(r"<[^>]+>", "\n", product.get("body_html") or ""))
    fibres = composition(text)
    title = f"{product.get('title', '')} {product.get('product_type', '')}".lower()
    fabric = next((f for f in FABRICS if re.search(rf"\b{re.escape(f)}\b", title)), None)
    if fabric is None:  # the description often names it too: "Fabric: Lawn"
        m = re.search(r"\bfabric\s*[:\-]\s*([a-z &]+)", text, re.I)
        fabric = next((f for f in FABRICS if m and re.search(rf"\b{f}\b", m.group(1), re.I)), None)
    if not fibres and not fabric:
        return None
    fabric = {"khadar": "khaddar", "wash and wear": "wash & wear"}.get(fabric, fabric)
    return {
        "fibres": fibres or [],
        "main_fibre": max(fibres, key=lambda f: f[1])[0] if fibres else "",
        "blend": blend(fibres) if fibres else "",
        "fabric": fabric or "",
    }


class Polite:
    """GET with an honest User-Agent, robots.txt checked per host, at most one request per
    ``gap`` seconds per pacing key: the store, so its photos on Shopify's shared CDN count against
    that store's own budget instead of throttling every store together."""

    def __init__(self, gap: float = 1.0):
        self.gap, self.robots, self.last, self.lock = gap, {}, {}, threading.Lock()

    def get(self, url: str, key: str | None = None, timeout: int = 30) -> bytes | None:
        host = url.split("/")[2]
        key = key or host
        with self.lock:
            if host not in self.robots:
                rp = urllib.robotparser.RobotFileParser(f"https://{host}/robots.txt")
                try:
                    rp.read()
                except Exception:  # noqa: BLE001 -- unreadable robots.txt: allowed, per RFC 9309
                    rp = None
                self.robots[host] = rp
            rp = self.robots[host]
        if rp is not None and not rp.can_fetch(UA, url):
            return None
        wait = self.last.get(key, 0) + self.gap - time.monotonic()  # one thread per key
        if wait > 0:
            time.sleep(wait)
        self.last[key] = time.monotonic()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception:  # noqa: BLE001 -- a refused or failed fetch is skipped, not retried hard
            return None


def scrape_store(
    store: str, out: Path, http: Polite, per_product: int, max_pages: int, max_images: int
) -> dict:
    from PIL import Image

    d = out / store
    (d / "img").mkdir(parents=True, exist_ok=True)
    rows, n_products, n_images, labelled = [], 0, 0, []
    for page in range(1, max_pages + 1):
        raw = http.get(f"https://{store}/products.json?limit=250&page={page}")
        products = json.loads(raw).get("products", []) if raw else []
        if not products:
            break
        for p in products:
            n_products += 1
            lab = label(p)
            if lab is None:
                continue
            labelled.append(lab)
            if n_images >= max_images:  # the catalogue is still read in full for the stats
                continue
            for k, im in enumerate(p.get("images", [])[:per_product]):
                path = d / "img" / f"{p['id']}_{k}.jpg"
                if not path.exists():
                    src = im["src"] + ("&" if "?" in im["src"] else "?") + "width=640"
                    data = http.get(src, key=store)
                    if not data:
                        continue
                    try:
                        img = Image.open(io.BytesIO(data)).convert("RGB")
                        img.thumbnail((640, 640))
                        img.save(path, quality=88)
                    except Exception:  # noqa: BLE001 -- an undecodable image is skipped
                        continue
                n_images += 1
                rows.append({"path": path.relative_to(out).as_posix(), "store": store,
                             "product_id": p["id"], "title": p.get("title", ""),
                             "url": f"https://{store}/products/{p.get('handle', '')}",
                             "fibres": json.dumps(lab["fibres"]), **{f: lab[f] for f in
                             ("main_fibre", "blend", "fabric")}, "image_index": k})  # fmt: skip
    with open(d / "manifest.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]) if rows else ["path"])
        w.writeheader()
        w.writerows(rows)
    from collections import Counter

    stats = {"store": store, "products": n_products, "labelled": len(labelled), "images": n_images,
             **{f: Counter(x[f] for x in labelled if x[f]).most_common(8)
                for f in ("main_fibre", "blend", "fabric")}}  # fmt: skip
    print(json.dumps(stats), flush=True)
    return stats


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--stores", nargs="+", required=True, help="Shopify store hosts")
    ap.add_argument("--out", type=Path, default=Path("data/shops"))
    ap.add_argument("--per-product", type=int, default=4, help="photos kept per labelled product")
    ap.add_argument("--max-pages", type=int, default=200, help="catalogue pages of 250 products")
    ap.add_argument("--max-images", type=int, default=9000, help="per store (~2.5 h at 1/s)")
    args = ap.parse_args(argv)
    http = Polite()
    jobs = [
        (s, args.out, http, args.per_product, args.max_pages, args.max_images) for s in args.stores
    ]
    threads = [threading.Thread(target=scrape_store, args=job) for job in jobs]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return 0


if __name__ == "__main__":
    sys.exit(main())
