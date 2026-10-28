"""Per-image feature cache: features survive a split change. Skipped without numpy."""

import pytest

np = pytest.importorskip("numpy")

from training.textilenet.feature_cache import FeatureCache  # noqa: E402


def _feats(paths, dim=4):
    return np.array([[hash(p) % 97 + i for i in range(dim)] for p in paths], dtype=np.float16)


def test_only_unseen_paths_are_missing_and_assembly_follows_request_order(tmp_path):
    cache = FeatureCache(tmp_path)
    assert cache.missing(["a", "b"]) == ["a", "b"]
    cache.add(["a", "b"], _feats(["a", "b"]))

    reopened = FeatureCache(tmp_path)  # a later run, e.g. after the split grew
    assert reopened.missing(["b", "c", "a", "d"]) == ["c", "d"]
    reopened.add(["c", "d"], _feats(["c", "d"]))

    got = FeatureCache(tmp_path).assemble(["d", "a", "c"])
    assert np.array_equal(got, _feats(["d", "a", "c"]))


def test_assembling_an_unknown_path_is_an_error(tmp_path):
    cache = FeatureCache(tmp_path)
    cache.add(["a"], _feats(["a"]))
    with pytest.raises(KeyError, match="zzz"):
        cache.assemble(["a", "zzz"])


def test_add_rejects_mismatched_lengths(tmp_path):
    with pytest.raises(ValueError):
        FeatureCache(tmp_path).add(["a", "b"], _feats(["a"]))
