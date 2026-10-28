"""Numerical and selection boundaries for the pattern head export."""
import numpy as np
import pytest
from sklearn.linear_model import LogisticRegression

from training.scanner.pattern_head import fold_linear, select_head


def test_binary_export_preserves_sklearn_probabilities():
    x = np.array([[-3., 1], [-2, 2], [2, 1], [3, 2]])
    mu, sd = x.mean(0), x.std(0) + 1e-6
    lr = LogisticRegression().fit((x - mu) / sd, [0, 0, 1, 1])
    w, b = fold_linear(lr, mu, sd)
    z = x @ w.T + b
    p = np.exp(z - z.max(1, keepdims=True))
    p /= p.sum(1, keepdims=True)
    np.testing.assert_allclose(p, lr.predict_proba((x - mu) / sd), rtol=1e-6)


def test_selection_and_standardisation_do_not_read_test_features_or_labels():
    x = np.array([[-3.], [-2], [2], [3], [-2.5], [2.5], [1000.], [-1000.]])
    y = np.array([0, 0, 1, 1, 0, 1, 0, 1])
    split = np.array(['train'] * 4 + ['val'] * 2 + ['test'] * 2)
    domains = np.array(['fashionpedia'] * 8)
    a, _ = select_head(x, y, split, domains, ['a', 'b'], modes=['fashionpedia'])
    y[-2:] = [1, 0]
    x[-2:] = [[-1e6], [1e6]]
    b, _ = select_head(x, y, split, domains, ['a', 'b'], modes=['fashionpedia'])
    np.testing.assert_array_equal(a['weight'], b['weight'])
    np.testing.assert_array_equal(a['bias'], b['bias'])
    assert a['C'] == b['C'] and a['val_score'] == b['val_score']


def test_selection_requires_validation_for_every_domain():
    with pytest.raises(ValueError, match='validation'):
        select_head(np.array([[-1.], [1.]]), np.array([0, 1]),
                    np.array(['train', 'train']), np.array(['fashionpedia'] * 2), ['a', 'b'])
