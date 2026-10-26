"""Cleaning comparisons require the same explicitly available photos for every feature set."""
from types import SimpleNamespace

import numpy as np
import pytest

from scripts.flag_labels import available_rows
from training.textilenet.feature_cache import FeatureCache


def test_missing_test_features_require_explicit_opt_in_and_use_common_rows(tmp_path):
    a, b = FeatureCache(tmp_path / 'a'), FeatureCache(tmp_path / 'b')
    a.add(['train.jpg', 'test.jpg'], np.ones((2, 3)))
    b.add(['train.jpg'], np.ones((1, 3)))
    rows = [SimpleNamespace(path='train.jpg', split='train'),
            SimpleNamespace(path='test.jpg', split='test')]
    with pytest.raises(ValueError, match='not cached'):
        available_rows(rows, [a, b])
    kept, missing = available_rows(rows, [a, b], allow_missing=True)
    assert [r.path for r in kept] == ['train.jpg']
    assert [r.path for r in missing] == ['test.jpg']
