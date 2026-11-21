# ruff: noqa: E501, B905
"""Synthetic fixtures only: no real photos, no real labels."""

import csv
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import eval_real_set as ev  # noqa: E402
import label_sheet as ls  # noqa: E402


def test_wilson():
    lo, hi = ev.wilson(0, 10)
    assert (round(lo, 4), round(hi, 4)) == (0.0, 0.2775)
    lo, hi = ev.wilson(5, 10)
    assert (round(lo, 4), round(hi, 4)) == (0.2366, 0.7634)
    assert ev.wilson(0, 0) is None


def test_macro_f1_hand_example():
    t = ["a"] * 3 + ["b"] * 5 + ["c"] * 2
    p = ["a", "a", "b"] + ["b"] * 5 + ["a", "c"]
    # min_n=3, c dropped. a: tp2 fp1(c->a) fn1 -> f=4/6; b: tp5 fp1 fn0 -> 10/11
    r = ev.macro_f1(t, p, min_n=3)
    assert r["dropped"] == {"c": 2}
    assert r["macro_f1"] == pytest.approx((4 / 6 + 10 / 11) / 2)
    assert r["accuracy"] == pytest.approx(0.8)


def test_macro_f1_refuses_when_no_class_eligible():
    r = ev.macro_f1(["a", "b"], ["a", "b"])
    assert r["macro_f1"] is None and r["reason"] == "no class has n>=5"
    assert ev.macro_f1([], [])["macro_f1"] is None


def test_kappa():
    assert ev.kappa(["a", "b", "a", "b"], ["a", "b", "a", "b"]) == 1.0
    # po 0.75, pe 0.5 -> 0.5
    assert ev.kappa(["y", "y", "n", "n"], ["y", "y", "n", "y"]) == pytest.approx(0.5)
    assert ev.kappa([], []) is None


def test_no_labels(tmp_path, capsys):
    assert ev.main(["--out", str(tmp_path)]) == 0
    (tmp_path / "labels").mkdir()
    assert ev.main(["--out", str(tmp_path)]) == 0
    assert "no human labels" in capsys.readouterr().out
    assert not (tmp_path / "eval.md").exists() and not (tmp_path / "eval.json").exists()


ROWS = [
    {"image_sha": f"{c}" * 8, "ext": "jpg", "excluded": "no", "scan_ids": f"scan-{c}", "group_id": "g"}
    for c in "bca"
] + [{"image_sha": "d" * 8, "ext": "png", "excluded": "yes", "scan_ids": "scan-d", "group_id": "d"}]


def test_page_is_blind_and_complete():
    html = ls.build_page(ROWS, "files")
    for bad in ("score", "confidence", "model_version", "verdict", "scan-a", "scan-b", "scan-c"):
        assert bad not in html
    assert "d" * 8 not in html  # excluded
    assert html.index("a" * 8) < html.index("b" * 8) < html.index("c" * 8)  # sha order
    assert " selected" not in html
    assert "a" * 8 + ".jpg" in html or '"ext": "jpg"' in html
    import inspect

    assert list(inspect.signature(ls.build_page).parameters) == ["manifest_rows", "image_dir"]


def _write_labels(out, name, rows):
    d = out / "labels"
    d.mkdir(exist_ok=True)
    cols = ["image_sha", "labeller", "saw_scan_result", "phone_or_download", "garment_type",
            "fault_visible", "fabric_structure_if_sure"]
    with open(d / f"{name}.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, cols)
        w.writeheader()
        for r in rows:
            w.writerow({"labeller": name, "saw_scan_result": "no", "phone_or_download": "phone",
                        "garment_type": "shirt", "fault_visible": "no", "fabric_structure_if_sure": "", **r})


def _pred(sha, garment=None, fault=None, structure=None):
    res = {"custom": {"garment_type": {"label": garment}} if garment else {}, "candidates": {},
           "structure_answer": structure, "fault": fault}
    return {"image_sha": sha, "result": res, "error": None}


def _write_preds(out, preds):
    (out / "predictions.jsonl").write_text("\n".join(json.dumps(p) for p in preds))


def test_eval_exclusions_and_garment(tmp_path):
    shas = [f"{i:02d}" * 4 for i in range(12)]
    # 5 shirts predicted right, 5 jeans predicted shirt
    rows, preds = [], []
    for i, s in enumerate(shas[:10]):
        rows.append({"image_sha": s, "garment_type": "shirt" if i < 5 else "jeans"})
        preds.append(_pred(s, garment="shirt"))
    rows.append({"image_sha": shas[10], "saw_scan_result": "yes"})
    rows.append({"image_sha": shas[11], "phone_or_download": "download"})
    preds += [_pred(shas[10], garment="shirt"), _pred(shas[11], garment="shirt")]
    rows.append({"image_sha": "ff" * 4})  # not in predictions
    rows.append({"image_sha": shas[0], "garment_type": "shirt"})  # duplicate, last wins
    _write_labels(tmp_path, "ana", rows)
    _write_preds(tmp_path, preds)
    r = ev.evaluate(tmp_path)
    assert r["counts"]["saw_scan_result_excluded"] == 1
    assert r["counts"]["download_excluded"] == 1
    assert r["counts"]["not_in_predictions"] == 1
    assert r["counts"]["duplicate_rows"] == 1
    g = r["garment"]
    assert g["n"] == 10 and g["accuracy"] == 0.5
    assert g["macro_f1"] == pytest.approx(1 / 3)  # shirt 2/3, jeans 0
    assert (tmp_path / "eval.json").exists() and (tmp_path / "eval.md").exists()
    md = (tmp_path / "eval.md").read_text()
    assert md.index("macro F1") < md.index("accuracy")
    assert "recall unmeasured" in md


def test_two_labellers_disagree_and_kappa(tmp_path):
    shas = ["aa" * 4, "bb" * 4]
    _write_labels(tmp_path, "ana", [{"image_sha": s, "garment_type": "shirt"} for s in shas])
    _write_labels(tmp_path, "bo", [{"image_sha": shas[0], "garment_type": "shirt"},
                                   {"image_sha": shas[1], "garment_type": "jeans"}])
    _write_preds(tmp_path, [_pred(s, garment="shirt") for s in shas])
    r = ev.evaluate(tmp_path)
    assert r["counts"]["labeller_disagreements"] == 1
    assert r["garment"]["n"] == 1  # disagreeing row became unsure
    assert r["kappa"]["garment_type"]["ana|bo"] is not None
    _write_labels(tmp_path, "solo", [])  # empty extra file changes nothing
    # single labeller: no kappa
    one = tmp_path / "one"
    one.mkdir()
    _write_labels(one, "ana", [{"image_sha": shas[0]}])
    _write_preds(one, [_pred(shas[0], garment="shirt")])
    assert ev.evaluate(one)["kappa"] is None


def test_fault_false_alarms_and_groups(tmp_path):
    def f(flag, ref="trained", skipped=None):
        return {"is_fault": flag, "skipped_reason": skipped, "reference": ref}

    shas = [f"{i:02x}" * 4 for i in range(5)]
    _write_labels(tmp_path, "ana", [{"image_sha": s, "fault_visible": "no"} for s in shas]
                  + [{"image_sha": "ee" * 4, "fault_visible": "yes"}])
    preds = [_pred(shas[0], fault=f(True)), _pred(shas[1], fault=f(False)),
             _pred(shas[2], fault=f(True, "self_relative")), _pred(shas[3], fault=f(True, skipped="x")),
             _pred(shas[4], fault=None), _pred("ee" * 4, fault=f(True))]
    _write_preds(tmp_path, preds)
    with open(tmp_path / "manifest.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["image_sha", "group_id"])
        for s, g in zip(shas, ["g1", "g1", "g2", "g3", "g4"]):
            w.writerow([s, g])
    r = ev.evaluate(tmp_path)["fault"]
    assert r["image"]["good"] == 3 and r["image"]["flagged"] == 2  # skipped + absent not judged
    assert r["image"]["per_1000"] == pytest.approx(1000 * 2 / 3)
    assert r["group"]["good"] == 2 and r["group"]["flagged"] == 2  # g1 any flagged, g2 flagged
    assert r["by_reference"]["trained"]["good"] == 2
    assert r["by_reference"]["self_relative"]["flagged"] == 1
    assert r["not_judged"] == 2
    assert r["recall"] == "recall unmeasured (1 defect photos)"


def test_structure_accuracy_and_coverage(tmp_path):
    shas = [f"{i:02x}" * 4 for i in range(3)]
    _write_labels(tmp_path, "ana", [{"image_sha": s, "fabric_structure_if_sure": "twill"} for s in shas])
    ans = lambda lab, unk: {"label": lab, "confidence": 0.5, "unknown": unk}  # noqa: E731
    _write_preds(tmp_path, [_pred(shas[0], structure=ans("twill", False)),
                            _pred(shas[1], structure=ans("canvas", False)),
                            _pred(shas[2], structure=ans("twill", True))])
    s = ev.evaluate(tmp_path)["structure"]
    assert s["n"] == 3 and s["answered"] == 2 and s["correct"] == 1
    assert "macro_f1" not in s
