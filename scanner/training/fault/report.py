"""Markdown results report for fault-detection runs.

Reads every ``<dataset>__<method>__<mode>.json`` in the given folders (each a list of row dicts)
and renders the summary tables. Every number is computed from those rows; a missing value is a dash.

Usage: python -m training.fault.report <dir> [<dir> ...] > out.md
"""

from __future__ import annotations

import json
import math
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

JURY_AUROC_PCT = 96.5
JURY_RECALL_PCT = 90.0
JURY_FA_PER_1000 = 5.0
DASH = "—"

# TODO: naming macro-F1 table and Part C (paired bootstrap) table are not rendered yet.
# Their JSON file formats are not fixed; add both once the formats are final.

Entry = tuple[str, dict[str, Any]]  # (source file name, row)


def _num(v: Any) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return float(v) if math.isfinite(v) else None


def _mean(vals: list[float | None]) -> float | None:
    present = [v for v in vals if v is not None]
    return sum(present) / len(present) if present else None


def _pooled(rows: list[dict[str, Any]], rate_key: str, n_key: str) -> float | None:
    """Sum(rate * n) / Sum(n) over rows where both are present.

    For a per-1000 false-alarm rate with n_good this equals pooled false alarms per 1000 good.
    For recall with n_defect it is pooled recall.
    """
    num = den = 0.0
    for r in rows:
        rate, n = _num(r.get(rate_key)), _num(r.get(n_key))
        if rate is None or n is None:
            continue
        num += rate * n
        den += n
    return num / den if den else None


def _pct(v: float | None) -> str:
    return DASH if v is None else f"{v * 100:.1f}"


def _fmt(v: float | None, signed: bool = False) -> str:
    if v is None:
        return DASH
    return f"{v:+.1f}" if signed else f"{v:.1f}"


def _load(dirs: list[Path]) -> list[Entry]:
    out: list[Entry] = []
    for d in dirs:
        for f in sorted(Path(d).glob("*.json")):
            try:
                rows = json.loads(f.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if not isinstance(rows, list):
                continue
            parts = f.stem.split("__")
            for r in rows:
                if not isinstance(r, dict):
                    continue
                r = dict(r)
                for i, key in enumerate(("dataset", "method", "mode")):
                    r[key] = str(r.get(key) or (parts[i] if i < len(parts) else DASH))
                r["category"] = str(r.get("category") or DASH)
                r["perturbation"] = str(r["perturbation"]) if r.get("perturbation") else None
                out.append((f.name, r))
    return out


def _sources(names: set[str]) -> str:
    return "Source: " + ", ".join(f"`{n}`" for n in sorted(names)) if names else "Source: none"


def _table(header: list[str], body: list[list[str]], sources: set[str]) -> list[str]:
    if not body:
        lines = ["_No rows._"]
    else:
        lines = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
        lines += ["| " + " | ".join(row) + " |" for row in body]
    return lines + ["", _sources(sources), ""]


def _group(entries: list[Entry]) -> dict[tuple[str, str, str], list[Entry]]:
    groups: dict[tuple[str, str, str], list[Entry]] = {}
    for e in entries:
        r = e[1]
        groups.setdefault((r["dataset"], r["method"], r["mode"]), []).append(e)
    return groups


def _unperturbed(entries: list[Entry]) -> list[Entry]:
    return [e for e in entries if e[1]["perturbation"] is None]


def _overview(entries: list[Entry]) -> list[str]:
    body, srcs = [], set()
    for key, items in sorted(_group(_unperturbed(entries)).items()):
        rows = [r for _, r in items]
        srcs.update(name for name, _ in items)
        body.append(
            [
                *key,
                str(len(rows)),
                _pct(_mean([_num(r.get("auroc")) for r in rows])),
                _pct(_mean([_num(r.get("pixel_auroc")) for r in rows])),
                _pct(_mean([_num(r.get("aupro")) for r in rows])),
                _pct(_mean([_num(r.get("f1")) for r in rows])),
                _fmt(_pooled(rows, "false_alarms_per_1000", "n_good")),
                _fmt(_mean([_num(r.get("latency_ms")) for r in rows])),
            ]
        )
    return [
        "## 1. Per dataset and method (unperturbed)",
        "",
        *_table(
            [
                "Dataset",
                "Method",
                "Mode",
                "Categories",
                "Image AUROC %",
                "Pixel AUROC %",
                "AUPRO %",
                "F1 % (at threshold)",
                "FA / 1000 good (pooled)",
                "ms / image",
            ],
            body,
            srcs,
        ),
    ]


def _worst(entries: list[Entry]) -> list[str]:
    body, srcs = [], set()
    for key, items in sorted(_group(_unperturbed(entries)).items()):
        srcs.update(name for name, _ in items)
        scored = [(_num(r.get("auroc")), r["category"]) for _, r in items]
        scored = [(a, c) for a, c in scored if a is not None]
        if scored:
            auc, cat = min(scored)
            body.append([*key, cat, _pct(auc)])
        else:
            body.append([*key, DASH, DASH])
    return [
        "## 2. Worst category per dataset and method (lowest image AUROC)",
        "",
        *_table(["Dataset", "Method", "Mode", "Worst category", "Image AUROC %"], body, srcs),
    ]


def _robustness(entries: list[Entry]) -> list[str]:
    clean: dict[tuple[str, str, str], dict[str, float]] = {}
    perturbed: dict[tuple[str, str, str, str], dict[str, float]] = {}
    srcs_by_key: dict[tuple[str, str, str, str], set[str]] = {}
    for name, r in entries:
        auc = _num(r.get("auroc"))
        if auc is None:
            continue
        base_key = (r["dataset"], r["method"], r["mode"])
        if r["perturbation"] is None:
            clean.setdefault(base_key, {})[r["category"]] = auc
        else:
            key = (*base_key, r["perturbation"])
            perturbed.setdefault(key, {})[r["category"]] = auc
            srcs_by_key.setdefault(key, set()).add(name)

    body, srcs = [], set()
    for key in sorted(perturbed):
        base = clean.get(key[:3], {})
        pert = perturbed[key]
        common = sorted(set(base) & set(pert))
        if not common:
            body.append([*key, "0", DASH, DASH, DASH])
            continue
        clean_mean = sum(base[c] for c in common) / len(common)
        pert_mean = sum(pert[c] for c in common) / len(common)
        body.append(
            [
                *key,
                str(len(common)),
                _pct(clean_mean),
                _pct(pert_mean),
                _fmt((pert_mean - clean_mean) * 100, signed=True),
            ]
        )
        srcs |= srcs_by_key[key]
    return [
        "## 3. Robustness (image AUROC drop under each perturbation)",
        "",
        "Drop = perturbed mean minus unperturbed mean over the same categories, in points.",
        "",
        *_table(
            [
                "Dataset",
                "Method",
                "Mode",
                "Perturbation",
                "Categories",
                "Clean image AUROC %",
                "Perturbed image AUROC %",
                "Drop (pts)",
            ],
            body,
            srcs,
        ),
    ]


def _jury(entries: list[Entry]) -> list[str]:
    head = ["## 4. Jury bar (AITEX)", ""]
    aitex = [e for e in _unperturbed(entries) if e[1]["dataset"] == "aitex"]
    if not aitex:
        return [*head, "no AITEX results yet", ""]

    body, srcs = [], set()
    for (_, method, mode), items in sorted(_group(aitex).items()):
        rows = [r for _, r in items]
        srcs.update(name for name, _ in items)
        auc = _mean([_num(r.get("auroc")) for r in rows])
        recall = _pooled(rows, "recall", "n_defect")
        fa = _pooled(rows, "false_alarms_per_1000", "n_good")

        auc_pct = None if auc is None else auc * 100
        recall_pct = None if recall is None else recall * 100
        body.append(
            [
                method,
                mode,
                _verdict(auc_pct, lambda v: v > JURY_AUROC_PCT, "%"),
                _verdict(recall_pct, lambda v: v >= JURY_RECALL_PCT, "%"),
                _verdict(fa, lambda v: v <= JURY_FA_PER_1000, "/ 1000"),
            ]
        )
    if not body:
        return [*head, "no AITEX results yet", ""]
    return [
        *head,
        f"Bars: image AUROC > {JURY_AUROC_PCT} %; pooled recall >= {JURY_RECALL_PCT:.0f} %; "
        f"pooled false alarms <= {JURY_FA_PER_1000:.0f} per 1000 good.",
        "",
        *_table(
            [
                "Method",
                "Mode",
                f"Mean image AUROC > {JURY_AUROC_PCT}",
                f"Pooled recall >= {JURY_RECALL_PCT:.0f} %",
                f"Pooled FA <= {JURY_FA_PER_1000:.0f} / 1000",
            ],
            body,
            srcs,
        ),
    ]


def _verdict(value: float | None, ok: Callable[[float], bool], unit: str) -> str:
    if value is None:
        return "MISS (no data)"
    return f"{'PASS' if ok(value) else 'MISS'} ({value:.1f} {unit})"


def render(results_dirs: list[Path]) -> str:
    entries = _load(list(results_dirs))
    head = [
        "# Fault detection results",
        "",
        "Input folders: " + (", ".join(f"`{d}`" for d in results_dirs) or DASH),
        "",
    ]
    if not entries:
        return "\n".join([*head, "No results found in the given folders.", ""])
    sections = _overview(entries) + _worst(entries) + _robustness(entries) + _jury(entries)
    return "\n".join([*head, *sections])


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if not args:
        print("usage: python -m training.fault.report <dir> [<dir> ...]", file=sys.stderr)
        return 2
    sys.stdout.write(render([Path(a) for a in args]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
