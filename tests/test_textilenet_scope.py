"""A product scope over TextileNet's fabric classes: fabric24 drops canvas and plush (not fabrics
the factories make) and counts jersey as knit (jersey is a knit). Same photos, same split."""

from training.textilenet.splits import PARTITIONS, Record, base_partition, class_index, rescope


def test_fabric24_has_the_24_classes_left_and_reads_fabric_photos():
    assert len(PARTITIONS["fabric24"]) == 24 and len(class_index("fabric24")) == 24
    assert not {"canvas", "plush", "jersey"} & set(PARTITIONS["fabric24"])
    assert base_partition("fabric24") == "fabric" and base_partition("fibre") == "fibre"


def test_rescope_drops_out_of_scope_photos_and_relabels_jersey_as_knit():
    rows = [Record(f"fabric/test/{c}/1.jpg", c, "test", "archive", c) for c in
            ("canvas", "plush", "jersey", "knit", "denim")]  # fmt: skip
    got = rescope(rows, "fabric24")
    assert [(r.label, r.path) for r in got] == [
        ("knit", "fabric/test/jersey/1.jpg"), ("knit", "fabric/test/knit/1.jpg"),
        ("denim", "fabric/test/denim/1.jpg")]  # fmt: skip
    assert rescope(rows, "fabric") == rows


def test_fabric22_is_fabric24_without_serge_and_chenille():
    assert set(PARTITIONS["fabric24"]) - set(PARTITIONS["fabric22"]) == {"serge", "chenille"}
    assert len(PARTITIONS["fabric22"]) == 22 and base_partition("fabric22") == "fabric"
