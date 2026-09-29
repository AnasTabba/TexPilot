"""A train.py checkpoint exported, installed on the real bundle and served. `pytest -m slow`.
Uses an untrained ViT-Tiny (no download) built by train.py's own create_model, so the
export and serving code must agree with how training built the model."""

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

pytestmark = pytest.mark.slow
BUNDLE = Path("models/scanner-v1")


def _fake_run(root, classes):
    import torch

    from training.textilenet.train import create_model

    args = SimpleNamespace(timm_name="vit_tiny_patch16_224", no_pretrained=True, drop_path=0.0,
                           img_size=64)  # fmt: skip
    model = create_model(args, len(classes))
    run = root / "runs" / "fabric" / "vit_tiny" / "seed0"
    run.mkdir(parents=True)
    torch.save({"model": model.state_dict(), "timm_name": args.timm_name, "classes": classes,
                "img_size": 64, "crop_pct": 0.875,
                "data_cfg": {"mean": (0.5, 0.5, 0.5), "std": (0.5, 0.5, 0.5)},
                "best": {"val_top1": 0.1}}, run / "best.pt")  # fmt: skip
    (run / "test_metrics.json").write_text(json.dumps({"best": {"val_top1": 0.1}}))
    return run


def _split(root, classes):
    from PIL import Image

    lines = ["path,label,split,source,sha1"]
    for split in ("val", "test"):
        for i, label in enumerate(classes[:4]):
            rel = f"fabric/{split}/{label}/{i}.jpg"
            (root / rel).parent.mkdir(parents=True, exist_ok=True)
            Image.new("RGB", (96, 80), (40 * i, 90, 160)).save(root / rel)
            lines.append(f"{rel},{label},{split},archive,x")
    (root / "split.csv").write_text("\n".join(lines) + "\n")
    return root / "split.csv"


def test_export_install_and_serve_a_fine_tuned_head_a(tmp_path):
    if not BUNDLE.exists():
        pytest.skip("models/scanner-v1 is not on this machine")
    import numpy as np
    import torch

    from services.vision.heads import LinearHeads
    from services.vision.taxonomy import FABRIC_CLASSES
    from training.scanner.export_head_a import main as export
    from training.scanner.install_head_a import install
    from training.textilenet.splits import class_index

    labels = class_index("fabric")
    classes = sorted(labels, key=labels.get)
    _fake_run(tmp_path, classes)
    split = _split(tmp_path, classes)
    head = tmp_path / "head_a"
    assert export(["--runs", str(tmp_path / "runs" / "fabric"), "--split-csv", str(split),
                   "--data-root", str(tmp_path), "--out", str(head), "--workers", "0",
                   "--device", "cpu", "--batch-size", "4"]) == 0  # fmt: skip
    info = json.loads((head / "head.json").read_text())
    assert info["val"]["n"] == 4 and info["test"]["n"] == 4 and info["classes"] == classes

    out = tmp_path / "scanner-v2"
    install(BUNDLE, head, out)
    heads = LinearHeads(out, torch.device("cpu"))
    assert heads.version == 2 and heads.structure_model is not None
    result = heads.predict([np.full((120, 100, 3), 150, np.uint8)])
    assert result.structure is None or result.structure.label in FABRIC_CLASSES
