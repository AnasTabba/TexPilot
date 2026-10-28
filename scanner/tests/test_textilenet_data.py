"""Image loading from the frozen split. Skipped where torch/PIL are absent (CI core)."""

import pytest

pytest.importorskip("torch")
Image = pytest.importorskip("PIL.Image")
np = pytest.importorskip("numpy")

from training.textilenet.data import TextileDataset, load_rows  # noqa: E402
from training.textilenet.splits import Record, write_csv  # noqa: E402


def _identity(image):
    return {"image": image}


def _jpeg(path, w, h, color=(200, 30, 30)):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (w, h), color).save(path, quality=90)


def _row(path, label, split="train"):
    return Record(path=path, label=label, split=split, source="archive", sha1=path)


def test_large_jpeg_is_draft_decoded_but_never_below_decode_size(tmp_path):
    _jpeg(tmp_path / "fabric/train/denim/big.jpg", 2400, 1800)
    ds = TextileDataset(
        [_row("fabric/train/denim/big.jpg", "denim")], tmp_path, {"denim": 6}, _identity, 448
    )
    img, label = ds[0]
    assert label == 6
    assert img.dtype == np.uint8 and img.shape[2] == 3
    assert min(img.shape[:2]) >= 448
    assert max(img.shape[:2]) < 2400  # draft actually reduced it


def test_png_with_alpha_and_truncated_jpeg_both_load(tmp_path):
    Image.new("RGBA", (64, 48), (0, 0, 255, 128)).save(tmp_path / "a.png")
    _jpeg(tmp_path / "full.jpg", 300, 200)
    data = (tmp_path / "full.jpg").read_bytes()
    (tmp_path / "cut.jpg").write_bytes(data[: len(data) * 2 // 3])
    rows = [_row("a.png", "lace"), _row("cut.jpg", "lace")]
    ds = TextileDataset(rows, tmp_path, {"lace": 14}, _identity, 32)
    assert ds[0][0].shape == (48, 64, 3)
    cut = ds[1][0]
    assert cut.shape[2] == 3 and min(cut.shape[:2]) >= 32  # decoded despite the missing tail


def test_load_rows_drops_missing_files_and_limits_per_class(tmp_path, capsys):
    rows = []
    for i in range(5):
        p = f"fabric/train/denim/{i}.jpg"
        _jpeg(tmp_path / p, 8, 8)
        rows.append(_row(p, "denim"))
    rows.append(_row("fabric/test/denim/gone.jpg", "denim", split="test"))
    write_csv(rows, tmp_path / "splits/fabric.csv")

    out = load_rows(tmp_path / "splits/fabric.csv", tmp_path)
    assert (len(out["train"]), len(out["test"])) == (5, 0)
    assert "1 split rows missing" in capsys.readouterr().out

    limited = load_rows(tmp_path / "splits/fabric.csv", tmp_path, limit_per_class=2)
    assert len(limited["train"]) == 2
