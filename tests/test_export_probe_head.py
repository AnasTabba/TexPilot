"""Exporting a frozen-encoder probe as a scanner Head A. Skipped without the ML stack."""

import csv
import json

import pytest

np = pytest.importorskip("numpy")
torch = pytest.importorskip("torch")
pytest.importorskip("timm")
pytest.importorskip("safetensors")

from training.scanner.export_probe_head import fold_standardisation, main  # noqa: E402
from training.textilenet.feature_cache import FeatureCache  # noqa: E402


def test_folding_the_standardisation_keeps_the_logits():
    rng = np.random.default_rng(0)
    x, mu, sd = rng.normal(size=(5, 4)), rng.normal(size=4), rng.uniform(0.5, 2, 4)
    w, b = rng.normal(size=(3, 4)), rng.normal(size=3)
    w2, b2 = fold_standardisation(w, b, mu, sd)
    assert np.allclose(((x - mu) / sd) @ w.T + b, x @ w2.T + b2)


def test_export_writes_a_calibrated_head_that_reproduces_the_probe(tmp_path):
    rng = np.random.default_rng(0)
    classes = ["a", "b", "c"]
    rows = [
        (f"fabric/{s}/{c}/{i}.jpg", c, s)
        for s in ("val", "test")
        for c in classes
        for i in range(30)
    ]
    with open(tmp_path / "split.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["path", "label", "split", "source", "sha1"])
        w.writerows([(p, c, s, "archive", p) for p, c, s in rows])
    y = np.array([classes.index(c) for _, c, _ in rows])
    feats = (
        rng.normal(size=(len(rows), 4)) + 3 * np.eye(4)[y]
    )  # separable, so calibration has answers
    name = "vit_tiny_patch16_224.augreg_in21k"
    FeatureCache(tmp_path / "feat" / "fabric" / f"{name}_224").add([p for p, _, _ in rows], feats)
    lin = torch.nn.Linear(4, 3)
    with torch.no_grad():
        lin.weight.copy_(torch.eye(3, 4) * 4)
        lin.bias.zero_()
    mu, sd = feats.mean(0), feats.std(0) + 1e-6
    run = tmp_path / "run"
    run.mkdir()
    head = dict(state_dict=lin.state_dict(), mu=mu, sd=sd, classes=classes, timm_name=name)
    torch.save(head | {"img_size": 224}, run / "head.pt")

    out = tmp_path / "head_a"
    main(["--run", str(run), "--split-csv", str(tmp_path / "split.csv"),
          "--feature-dir", str(tmp_path / "feat"), "--out", str(out)])  # fmt: skip

    meta = json.loads((out / "head.json").read_text())
    assert meta["pool"] == "probe" and meta["classes"] == classes and meta["timm_name"] == name
    assert meta["temperature"] > 0 and 0 < meta["threshold"] <= 1.01 and len(meta["mean"]) == 3
    from safetensors.numpy import load_file

    t = load_file(str(out / "probe.safetensors"))
    with torch.no_grad():
        want = lin(torch.from_numpy((feats - mu) / sd).float()).numpy()
    assert np.allclose(feats @ t["probe.weight"].T + t["probe.bias"], want, atol=1e-4)
