# ruff: noqa: E501, B905
"""Blind labelling page for the real-upload set. The page never shows model output.

cd scanner && ../.venv/bin/python scripts/label_sheet.py --out runs/real_uploads/2026-11-22
Open runs/real_uploads/2026-11-22/label/index.html, type your name, label every photo, press "Download CSV",
and put the file in runs/real_uploads/2026-11-22/labels/. Static page: no server, no network.
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.vision.taxonomy import FABRIC_CLASSES  # noqa: E402

# The 13 taught garment classes (models/custom/garment_type/head.json) plus two escape values.
GARMENT_CLASSES = ("dress", "dupatta_shawl", "hoodie", "jacket", "jeans", "kurta", "polo", "shirt",
                   "shorts", "sweater", "t_shirt", "trousers", "unstitched_suit")
COLUMNS = ["image_sha", "labeller", "saw_scan_result", "phone_or_download", "garment_type",
           "fault_visible", "fabric_structure_if_sure"]


def _select(name, options, label):
    opts = "".join(f'<option value="{html.escape(o)}">{html.escape(o)}</option>' for o in options)
    return f'<label>{label} <select id="{name}"><option value=""></option>{opts}</select></label>'


JS = r"""
const COLS = %(cols)s, IMGS = %(imgs)s, DIR = %(dir)s, KEY = "real_upload_labels_v1";
let saved = JSON.parse(localStorage.getItem(KEY) || "{}"), i = 0;
const $ = id => document.getElementById(id);
const F = ["phone_or_download", "garment_type", "fault_visible", "fabric_structure_if_sure"];
function show() {
  const im = IMGS[i]; if (!im) { $("img").removeAttribute("src"); $("pos").textContent = "no images"; return; }
  $("img").src = DIR + "/" + im.sha + "." + im.ext;
  $("pos").textContent = (i + 1) + " / " + IMGS.length + (saved[im.sha] ? " (saved)" : "");
  const r = saved[im.sha] || {};
  F.forEach(f => $(f).value = r[f] || "");
  $("saw_scan_result").checked = r.saw_scan_result === "yes";
}
function save() {
  const im = IMGS[i];
  for (const f of ["phone_or_download", "garment_type", "fault_visible"])
    if (!$(f).value) { alert("Fill " + f + " (use unsure if you cannot tell)"); return false; }
  const r = {image_sha: im.sha, saw_scan_result: $("saw_scan_result").checked ? "yes" : "no"};
  F.forEach(f => r[f] = $(f).value);
  saved[im.sha] = r; localStorage.setItem(KEY, JSON.stringify(saved)); return true;
}
$("name").value = localStorage.getItem(KEY + "_name") || "";
$("name").oninput = () => localStorage.setItem(KEY + "_name", $("name").value);
$("next").onclick = () => { if (save()) { i = Math.min(i + 1, IMGS.length - 1); show(); } };
$("prev").onclick = () => { i = Math.max(i - 1, 0); show(); };
$("dl").onclick = () => {
  const who = $("name").value.trim().replace(/[^A-Za-z0-9_-]/g, "_");
  if (!who) { alert("Type your name first"); return; }
  const q = v => '"' + String(v).replace(/"/g, '""') + '"';
  const rows = IMGS.filter(m => saved[m.sha]).map(m => COLS.map(c => q(c === "labeller" ? who : saved[m.sha][c] || "")).join(","));
  const blob = new Blob([COLS.join(",") + "\n" + rows.join("\n") + "\n"], {type: "text/csv"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "labels_" + who + ".csv"; a.click();
};
show();
"""


def build_page(manifest_rows, image_dir) -> str:
    """Static labelling page from manifest rows only (no predictions). Sorted by image_sha."""
    imgs = [{"sha": r["image_sha"], "ext": r["ext"].lstrip(".").lower()}
            for r in sorted(manifest_rows, key=lambda r: r["image_sha"]) if r.get("excluded") != "yes"]
    js = JS % {"cols": json.dumps(COLUMNS), "imgs": json.dumps(imgs), "dir": json.dumps(str(image_dir))}
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Label photos</title>
<style>body{{font:16px system-ui;max-width:820px;margin:1rem auto;padding:0 1rem}}
img{{max-width:100%;max-height:60vh;display:block;margin:.5rem 0}}label{{display:block;margin:.4rem 0}}</style></head><body>
<h1>Label photos</h1>
<p>Label from the photo only. Do not look up any scanner answer. Use <b>unsure</b> when you cannot tell.
Tick the box only if you already saw this photo's scan result.</p>
<label>Your name <input id="name"></label>
<div id="pos"></div><img id="img" alt="photo to label">
<label><input type="checkbox" id="saw_scan_result"> I saw this photo's scan result before</label>
{_select("phone_or_download", ("phone", "download", "unsure"), "Phone photo or downloaded image?")}
{_select("garment_type", GARMENT_CLASSES + ("other", "unsure"), "Garment type")}
{_select("fault_visible", ("yes", "no", "unsure"), "Fabric fault visible?")}
{_select("fabric_structure_if_sure", FABRIC_CLASSES, "Fabric structure (only if you are sure)")}
<p><button id="prev">Back</button> <button id="next">Save and next</button> <button id="dl">Download CSV</button></p>
<script>{js}</script></body></html>"""


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--photos", type=Path, default=Path("data/scans/photos"))
    a = ap.parse_args(argv)
    with open(a.out / "manifest.csv", newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    dest = a.out / "label"
    dest.mkdir(exist_ok=True)
    missing = 0
    for r in rows:
        if r.get("excluded") == "yes":
            continue
        src = next((p for sid in r["scan_ids"].split(";") for p in a.photos.glob(f"{sid}_garment.*")), None)
        if src is None:
            missing += 1
            continue
        shutil.copyfile(src, dest / f"{r['image_sha']}.{r['ext'].lstrip('.').lower()}")
    (dest / "index.html").write_text(build_page(rows, "."), encoding="utf-8")
    print(f"wrote {dest / 'index.html'}; {missing} photos not found")
    return 0


if __name__ == "__main__":
    sys.exit(main())
