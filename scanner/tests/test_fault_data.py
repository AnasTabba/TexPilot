"""Fault dataset index: MVTec-layout and AITEX sets, fixed calibration split, CSV round-trip."""
from pathlib import Path

from training.fault.data import Sample, index_aitex, index_mvtec_layout, load_index, save_index


def _touch(p: Path) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"")


def _mvtec_bottle(root: Path) -> Path:
    cat = root / "bottle"
    for i in range(30):
        _touch(cat / "train" / "good" / f"{i:03d}.png")
    for i in range(5):
        _touch(cat / "test" / "good" / f"g{i}.png")
    for i in range(4):
        _touch(cat / "test" / "hole" / f"h{i}.png")
        _touch(cat / "ground_truth" / "hole" / f"h{i}_mask.png")
    return root


def test_mvtec_layout_counts(tmp_path: Path) -> None:
    root = _mvtec_bottle(tmp_path)
    samples = index_mvtec_layout(root, "mvtec")

    calib = [s for s in samples if s.split == "calib"]
    train = [s for s in samples if s.split == "train"]
    test = [s for s in samples if s.split == "test"]
    assert len(calib) == 15  # max(floor(10 % of 30) = 3, min(20, 15)) = 15
    assert len(train) == 15
    assert len(test) == 9

    train_good = sorted(s.path for s in calib + train)
    assert train_good == sorted(str(p) for p in (root / "bottle/train/good").iterdir())
    assert {s.path for s in calib}.isdisjoint({s.path for s in train})

    defects = [s for s in test if s.label == 1]
    assert len(defects) == 4
    assert all(s.mask is not None and Path(s.mask).exists() for s in defects)
    assert all(s.category == "bottle" and s.dataset == "mvtec" for s in samples)


def test_calib_is_deterministic(tmp_path: Path) -> None:
    root = _mvtec_bottle(tmp_path)
    first = [s.path for s in index_mvtec_layout(root, "mvtec") if s.split == "calib"]
    second = [s.path for s in index_mvtec_layout(root, "mvtec") if s.split == "calib"]
    assert first == second
    assert len(first) == 15


def test_aitex_groups_by_fabric(tmp_path: Path) -> None:
    root = tmp_path
    for i in range(10):
        _touch(root / "NODefect_images" / "01" / f"{i:04d}_000_01.png")
    _touch(root / "Defect_images" / "0001_002_01.png")
    _touch(root / "Mask_images" / "0001_002_01_mask.png")
    _touch(root / "Defect_images" / "0003_002_02.png")  # fabric 02 has no mask file

    samples = index_aitex(root)

    assert {s.category for s in samples} == {"01", "02"}
    assert all(s.dataset == "aitex" for s in samples)
    defects = {Path(s.path).name: s for s in samples if s.label == 1}
    assert Path(defects["0001_002_01.png"].mask).name == "0001_002_01_mask.png"
    assert defects["0001_002_01.png"].category == "01"
    assert defects["0003_002_02.png"].mask is None
    # 70 % of the 10 fabric-01 good images go to train, the rest to test.
    fab01_good = [s for s in samples if s.label == 0 and s.category == "01"]
    assert sum(s.split == "test" for s in fab01_good) == 3
    assert sum(s.split in ("train", "calib") for s in fab01_good) == 7


def test_aitex_two_masks_joined_and_roundtrip(tmp_path: Path) -> None:
    root = tmp_path
    _touch(root / "NODefect_images" / "01" / "0018_00_01.png")  # 2-digit middle field
    _touch(root / "Defect_images" / "0044_019_04.png")
    _touch(root / "Mask_images" / "0044_019_04_mask1.png")
    _touch(root / "Mask_images" / "0044_019_04_mask2.png")
    _touch(root / "Defect_images" / "0100_025_08.png")  # no mask at all

    samples = index_aitex(root)

    good = {Path(s.path).name: s for s in samples if s.label == 0}
    assert good["0018_00_01.png"].category == "01"
    defects = {Path(s.path).name: s for s in samples if s.label == 1}
    assert [Path(m).name for m in defects["0044_019_04.png"].mask.split(";")] == [
        "0044_019_04_mask1.png",
        "0044_019_04_mask2.png",
    ]
    assert defects["0100_025_08.png"].mask is None
    csv_path = tmp_path / "aitex.csv"
    save_index(samples, csv_path)
    assert load_index(csv_path) == samples


def test_index_roundtrip(tmp_path: Path) -> None:
    samples = index_mvtec_layout(_mvtec_bottle(tmp_path / "ds"), "mvtec")
    samples.append(Sample("x.png", 1, None, "bottle", "mvtec", "test"))
    csv_path = tmp_path / "index.csv"
    save_index(samples, csv_path)
    assert load_index(csv_path) == samples


def test_mask_bare_stem_and_missing_mask(tmp_path: Path) -> None:
    _touch(tmp_path / "crack" / "train" / "good" / "g0.png")
    _touch(tmp_path / "crack" / "test" / "crack" / "c1.png")
    _touch(tmp_path / "crack" / "ground_truth" / "crack" / "c1.png")  # bare stem, no _mask
    _touch(tmp_path / "crack" / "test" / "crack" / "c2.png")  # no mask at all

    by_name = {Path(s.path).name: s for s in index_mvtec_layout(tmp_path, "mvtec")}

    assert by_name["c1.png"].mask == str(tmp_path / "crack/ground_truth/crack/c1.png")
    assert by_name["c2.png"].mask is None
    assert by_name["g0.png"].label == 0 and by_name["g0.png"].mask is None


def test_defect_type_folder_with_space(tmp_path: Path) -> None:
    _touch(tmp_path / "tile" / "train" / "good" / "g0.png")
    _touch(tmp_path / "tile" / "test" / "Blob Patch" / "b1.png")
    _touch(tmp_path / "tile" / "ground_truth" / "Blob Patch" / "b1_mask.png")

    samples = index_mvtec_layout(tmp_path, "mvtec", ["tile"])

    (defect,) = [s for s in samples if s.label == 1]
    assert defect.path == str(tmp_path / "tile/test/Blob Patch/b1.png")
    assert defect.mask == str(tmp_path / "tile/ground_truth/Blob Patch/b1_mask.png")
    assert defect.split == "test"
