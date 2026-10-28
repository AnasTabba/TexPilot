"""The split audit must distinguish missing files and exact leakage from a real dataset."""

from training.textilenet.audit import audit_records
from training.textilenet.splits import Record


def test_audit_counts_imbalance_missing_files_and_cross_split_duplicates(tmp_path):
    (tmp_path / "a.jpg").write_bytes(b"a")
    (tmp_path / "b.jpg").write_bytes(b"b")
    (tmp_path / "c.jpg").write_bytes(b"c")
    rows = [
        Record("a.jpg", "denim", "train", "archive", "sha-a"),
        Record("b.jpg", "denim", "train", "archive", "sha-b"),
        Record("missing.jpg", "lace", "train", "scraped", "sha-c"),
        Record("c.jpg", "lace", "val", "scraped", "sha-a"),
    ]

    report = audit_records(rows, tmp_path, ("denim", "lace", "tweed"))

    assert report["total_rows"] == 4
    assert report["splits"]["train"]["class_counts"] == {"denim": 2, "lace": 1, "tweed": 0}
    assert report["splits"]["train"]["majority_minority_ratio"] == 2.0
    assert report["splits"]["train"]["absent_classes"] == ["tweed"]
    assert report["missing_files"] == ["missing.jpg"]
    assert report["cross_split_sha1"] == [{"sha1": "sha-a", "splits": ["train", "val"]}]
    assert report["sources"] == {"archive": 2, "scraped": 2}
    assert report["near_duplicate_status"] == "not_measured"


def test_empty_split_never_pretends_zero_imbalance():
    report = audit_records([], None, ("denim", "lace"))
    assert report["splits"]["train"]["majority_minority_ratio"] is None
    assert report["splits"]["train"]["entropy_normalized"] is None
    assert report["splits"]["train"]["n"] == 0
