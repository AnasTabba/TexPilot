# ruff: noqa: E501, B905
"""Score the real-upload set from HUMAN labels only. Never writes or edits a label, never tunes a threshold.

cd scanner && ../.venv/bin/python scripts/eval_real_set.py --out runs/real_uploads/2026-11-22

Reads <out>/predictions.jsonl, <out>/labels/*.csv (and <out>/manifest.csv for groups); writes eval.md and
eval.json. No labels: prints "no human labels" and exits 0. Numbers come from real uploads, not catalogue photos.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from collections import Counter, defaultdict
from itertools import combinations
from pathlib import Path

Z = 1.959964
MIN_CLASS_N = 5
FAULT_RECALL_MIN = 10


def wilson(k: int, n: int):
    if n <= 0:
        return None
    p = k / n
    d = 1 + Z * Z / n
    c = (p + Z * Z / (2 * n)) / d
    h = Z * math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n)) / d
    return max(0.0, c - h), min(1.0, c + h)


def macro_f1(y_true, y_pred, min_n: int = MIN_CLASS_N):
    """Macro F1 over true classes with n >= min_n; smaller classes are dropped and listed."""
    n = Counter(y_true)
    keep = sorted(c for c, k in n.items() if k >= min_n)
    dropped = {c: k for c, k in sorted(n.items()) if k < min_n}
    acc = sum(t == p for t, p in zip(y_true, y_pred)) / len(y_true) if y_true else None
    if not keep:
        return {"macro_f1": None, "reason": f"no class has n>={min_n}", "dropped": dropped, "accuracy": acc}
    per = {}
    for c in keep:
        tp = sum(t == c and p == c for t, p in zip(y_true, y_pred))
        fp = sum(t != c and p == c for t, p in zip(y_true, y_pred))
        fn = n[c] - tp
        per[c] = {"n": n[c], "f1": 2 * tp / (2 * tp + fp + fn)}
    return {"macro_f1": sum(v["f1"] for v in per.values()) / len(per), "per_class": per,
            "dropped": dropped, "accuracy": acc}


def kappa(a, b):
    n = len(a)
    if n == 0:
        return None
    po = sum(x == y for x, y in zip(a, b)) / n
    ca, cb = Counter(a), Counter(b)
    pe = sum(ca[c] * cb[c] for c in ca) / (n * n)
    return 1.0 if pe == 1 else (po - pe) / (1 - pe)


def _rate(k, n):
    ci = wilson(k, n)
    return {"k": k, "n": n, "rate": k / n if n else None, "ci95": ci}


def _read_csv(p: Path):
    with open(p, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def load_labels(out: Path):
    """{labeller: {sha: row}} (last row wins) and the number of duplicate rows."""
    by, dup = {}, 0
    for p in sorted((out / "labels").glob("*.csv")) if (out / "labels").is_dir() else []:
        for r in _read_csv(p):
            who = (r.get("labeller") or p.stem).strip() or p.stem
            d = by.setdefault(who, {})
            dup += r["image_sha"] in d
            d[r["image_sha"]] = r
    return {w: d for w, d in by.items() if d}, dup


def _consensus(rows, field):
    """Value all labellers agree on; 'unsure' when they differ. Empty values are ignored."""
    vals = {(r.get(field) or "").strip() for r in rows} - {""}
    return (vals.pop() if len(vals) == 1 else "unsure"), len(vals) > 1


def _shown_garment(res):
    g = (res.get("custom") or {}).get("garment_type")
    if g and g.get("label"):
        return g["label"]
    c = (res.get("candidates") or {}).get("garment_type")
    return c[0][0] if c else "no answer"


def _fault(items, groups):
    """items: [(sha, fault_visible, fault dict|None)]."""
    judged, not_judged, yes = [], 0, []
    for sha, vis, f in items:
        ran = f is not None and not f.get("skipped_reason")
        if vis == "yes" and ran:
            yes.append(bool(f["is_fault"]))
        elif vis == "no":
            if ran:
                judged.append((sha, bool(f["is_fault"]), f.get("reference") or "unknown"))
            else:
                not_judged += 1

    def block(rows):
        k, n = sum(r[1] for r in rows), len(rows)
        r = {"good": n, "flagged": k, "per_1000": 1000 * k / n if n else None,
             "ci95_per_1000": [1000 * x for x in wilson(k, n)] if n else None}
        return r

    by_group = defaultdict(list)
    for sha, flag, _ in judged:
        by_group[groups.get(sha, sha)].append(flag)
    # ponytail: a group missing from `judged` members (labelled not-no) is still good if the others are no
    out = {"image": block(judged), "group": block([(g, any(v), None) for g, v in by_group.items()]),
           "by_reference": {}, "not_judged": not_judged}
    for ref in sorted({r[2] for r in judged}):
        out["by_reference"][ref] = block([r for r in judged if r[2] == ref])
    out["recall"] = (_rate(sum(yes), len(yes)) if len(yes) >= FAULT_RECALL_MIN
                     else f"recall unmeasured ({len(yes)} defect photos)")
    return out


def evaluate(out: Path):
    out = Path(out)
    labels, dup = load_labels(out)
    if not labels:
        return None
    preds = {}
    pf = out / "predictions.jsonl"
    for line in pf.read_text().splitlines() if pf.exists() else []:
        if line.strip():
            p = json.loads(line)
            preds[p["image_sha"]] = p
    groups = {}
    if (out / "manifest.csv").exists():
        groups = {r["image_sha"]: r.get("group_id") or r["image_sha"] for r in _read_csv(out / "manifest.csv")}
    shas = sorted({s for d in labels.values() for s in d})
    cnt = Counter(duplicate_rows=dup, labellers=len(labels), labelled_images=len(shas))
    garment_t, garment_p, structure, fault_items = [], [], [], []
    consensus = {}
    for sha in shas:
        rows = [d[sha] for d in labels.values() if sha in d]
        if sha not in preds:
            cnt["not_in_predictions"] += 1
            continue
        if preds[sha].get("error") or not preds[sha].get("result"):
            cnt["prediction_error"] += 1
            continue
        if any((r.get("saw_scan_result") or "").strip() == "yes" for r in rows):
            cnt["saw_scan_result_excluded"] += 1
            continue
        if any((r.get("phone_or_download") or "").strip() == "download" for r in rows):
            cnt["download_excluded"] += 1
            continue
        vals, dis = {}, False
        for f in ("garment_type", "fault_visible", "fabric_structure_if_sure"):
            vals[f], d = _consensus(rows, f)
            dis |= d
        cnt["labeller_disagreements"] += dis
        cnt["evaluated_rows"] += 1
        consensus[sha] = vals
        res = preds[sha]["result"]
        if vals["garment_type"] not in ("unsure", ""):
            garment_t.append(vals["garment_type"])
            garment_p.append(_shown_garment(res))
        if vals["fabric_structure_if_sure"] not in ("unsure", ""):
            sa = res.get("structure_answer") or res.get("structure") or {}
            ans = sa.get("label") if sa and not sa.get("unknown") else None
            structure.append((vals["fabric_structure_if_sure"], ans))
        if vals["fault_visible"] in ("yes", "no"):
            fault_items.append((sha, vals["fault_visible"], res.get("fault")))
    r = {"note": "real uploads, human labels only; not comparable with catalogue or WFDD numbers",
         "counts": dict(cnt)}
    g = macro_f1(garment_t, garment_p)
    r["garment"] = {**g, "n": len(garment_t), "accuracy_ci95": wilson(
        sum(t == p for t, p in zip(garment_t, garment_p)), len(garment_t)),
        "answered": sum(p != "no answer" for p in garment_p)}
    ans = [(t, a) for t, a in structure if a is not None]
    r["structure"] = {"n": len(structure), "answered": len(ans), "correct": sum(t == a for t, a in ans),
                      "coverage": _rate(len(ans), len(structure)),
                      "accuracy_answered": _rate(sum(t == a for t, a in ans), len(ans))}
    r["fault"] = _fault(fault_items, groups)
    r["kappa"] = None
    if len(labels) > 1:
        r["kappa"] = {}
        for f in ("garment_type", "fault_visible"):
            r["kappa"][f] = {}
            for (a, da), (b, db) in combinations(sorted(labels.items()), 2):
                common = sorted(set(da) & set(db))
                r["kappa"][f][f"{a}|{b}"] = kappa([da[s].get(f, "") for s in common],
                                                  [db[s].get(f, "") for s in common])
    (out / "eval.json").write_text(json.dumps(r, indent=2))
    (out / "eval.md").write_text(_md(r))
    return r


def _pct(x):
    return "n/a" if x is None else f"{100 * x:.1f}%"


def _ci(ci):
    return "" if not ci else f" (95% CI {_pct(ci[0])} to {_pct(ci[1])})"


def _md(r):
    c, g, s, f = r["counts"], r["garment"], r["structure"], r["fault"]
    L = ["# Real-upload evaluation (human labels)", "", r["note"], "", "## Counts", ""]
    L += [f"- {k}: {v}" for k, v in c.items()]
    L += ["", f"## Garment type (n={g['n']}, answered by the system: {g['answered']})", ""]
    mf = g["macro_f1"]
    L.append("- macro F1: " + (f"{mf:.3f}" if mf is not None else f"not computed ({g['reason']})"))
    L.append(f"- accuracy: {_pct(g['accuracy'])}{_ci(g['accuracy_ci95'])}")
    if g["dropped"]:
        L.append(f"- classes dropped (n<{MIN_CLASS_N}): {g['dropped']}")
    L += ["", f"## Fabric structure (labelled n={s['n']}; accuracy and coverage only, no macro F1)", "",
          f"- coverage: {_pct(s['coverage']['rate'])}{_ci(s['coverage']['ci95'])}",
          f"- accuracy on answered: {_pct(s['accuracy_answered']['rate'])}{_ci(s['accuracy_answered']['ci95'])}",
          "", f"## Fault false alarms per 1,000 good photos ({f['not_judged']} good photos not judged: check skipped or absent)", ""]
    for name in ("image", "group"):
        b = f[name]
        ci = b["ci95_per_1000"]
        L.append(f"- {name}-level: {b['flagged']}/{b['good']}"
                 + (f" = {b['per_1000']:.0f} per 1,000 (95% CI {ci[0]:.0f} to {ci[1]:.0f})" if ci else ""))
    for ref, b in f["by_reference"].items():
        L.append(f"- reference {ref}: {b['flagged']}/{b['good']}")
    rec = f["recall"]
    L.append(f"- recall: {rec if isinstance(rec, str) else _pct(rec['rate']) + _ci(rec['ci95'])}")
    if r["kappa"]:
        L += ["", "## Labeller agreement (Cohen's kappa)", ""] + [f"- {k}: {v}" for k, v in r["kappa"].items()]
    return "\n".join(L) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", required=True, type=Path)
    a = ap.parse_args(argv)
    r = evaluate(a.out)
    if r is None:
        print("no human labels")
        return 0
    print((a.out / "eval.md").read_text())
    return 0


if __name__ == "__main__":
    sys.exit(main())
