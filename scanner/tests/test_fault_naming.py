"""Defect naming classifier (plan Task 7). Synthetic features only, no real model."""

import joblib
import numpy as np
import pytest
from sklearn.metrics import f1_score

from training.fault.naming import NamingModel, fit_naming

SEED = 2026


def _separable(n_groups: int = 6, per_group: int = 5, seed: int = SEED):
    """Three well-separated classes; each group holds a few rows of one class."""
    rng = np.random.default_rng(seed)
    centres = {"hole": [0, 0, 0, 0], "stain": [5, 5, 0, 0], "thread": [0, 0, 5, 5]}
    feats, labels, groups = [], [], []
    for cls, centre in centres.items():
        for gi in range(n_groups):
            for _ in range(per_group):
                feats.append(np.asarray(centre, float) + rng.normal(0, 0.3, 4))
                labels.append(cls)
                groups.append(f"{cls}-{gi}")
    return np.vstack(feats), labels, groups


def test_separable_features_give_macro_f1_one():
    x, y, g = _separable()
    model = fit_naming(x, y, g)
    x_test, y_test, _ = _separable(seed=7)
    preds = model.predict(x_test)
    keep = [i for i, (p, _) in enumerate(preds) if p is not None]
    assert len(keep) >= 0.9 * len(y_test)  # the val-chosen cut may abstain on a few rows
    answered = [preds[i][0] for i in keep]
    assert f1_score([y_test[i] for i in keep], answered, average="macro") == pytest.approx(1.0)


def test_low_confidence_row_is_none():
    x, y, g = _separable()
    model = fit_naming(x, y, g)
    model.threshold = 1.01  # nothing can clear this cut
    cls, p = model.predict(x[:1])[0]
    assert cls is None
    assert 0.0 < p <= 1.0


def test_threshold_and_val_stats_are_set():
    x, y, g = _separable()
    model = fit_naming(x, y, g)
    assert isinstance(model, NamingModel)
    assert model.classes == ["hole", "stain", "thread"]
    assert 0.0 <= model.threshold <= 1.0
    assert 0.0 <= model.val_precision <= 1.0
    assert 0.0 < model.val_coverage <= 1.0


def test_same_input_gives_same_threshold():
    # fit_naming only sees the rows it is given and has no randomness beyond the seed,
    # so the cut cannot depend on anything outside its arguments.
    x, y, g = _separable()
    a = fit_naming(x, y, g)
    b = fit_naming(x.copy(), list(y), list(g))
    assert a.threshold == b.threshold
    assert (a.val_precision, a.val_coverage) == (b.val_precision, b.val_coverage)
    assert a.predict(x[:20]) == b.predict(x[:20])


def test_single_group_per_class_raises_value_error():
    x, y, g = _separable(n_groups=1)
    with pytest.raises(ValueError, match="at least 2 groups per class"):
        fit_naming(x, y, g)


def test_model_survives_joblib_roundtrip(tmp_path):
    x, y, g = _separable()
    model = fit_naming(x, y, g)
    path = tmp_path / "naming.joblib"
    joblib.dump(model, path)
    loaded = joblib.load(path)
    assert loaded.classes == model.classes
    assert loaded.threshold == model.threshold
    assert loaded.predict(x[:30]) == model.predict(x[:30])
