"""Linear pattern head selection on validation only; export shares v8's encoder."""
from __future__ import annotations

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score


def fold_linear(lr, mu, sd):
    """Fold standardisation into raw-feature logits, including sklearn's binary convention."""
    w = lr.coef_ / sd
    b = lr.intercept_ - w @ mu
    if len(lr.classes_) == 2:
        w, b = np.vstack([-w / 2, w / 2]), np.array([-b[0] / 2, b[0] / 2])
    return w.astype(np.float32), b.astype(np.float32)


def select_head(x, y, split, domains, classes, modes=None):
    """Choose training-domain recipe and C by mean per-domain validation macro F1.

    Only train arrays fit scaling/classifier. Test features/labels never enter selection.
    Each validation domain is scored on labels supported in that domain's training rows.
    """
    modes = modes or ['fashionpedia', 'mixed']
    domain_names = sorted(set(domains))
    supported = {d: np.unique(y[(split == 'train') & (domains == d)]) for d in domain_names}
    for d in domain_names:
        if not ((split == 'val') & (domains == d)).any():
            raise ValueError(f'{d}: no validation rows')
    best, grid = None, []
    for mode in modes:
        tr = (split == 'train') & ((domains == 'fashionpedia') if mode == 'fashionpedia' else True)
        if len(np.unique(y[tr])) != len(classes):
            raise ValueError('training recipe does not support every exported class')
        mu, sd = x[tr].mean(0), x[tr].std(0) + 1e-6
        ztr = (x[tr] - mu) / sd
        # Equal total weight per training domain, in addition to balanced class weights.
        weights = np.ones(int(tr.sum()))
        for d in np.unique(domains[tr]):
            m = domains[tr] == d
            weights[m] = len(weights) / (len(np.unique(domains[tr])) * m.sum())
        for c in (0.1, 0.3, 1.0):
            lr = LogisticRegression(C=c, max_iter=2000, class_weight='balanced',
                                    random_state=0).fit(ztr, y[tr], sample_weight=weights)
            w, b = fold_linear(lr, mu, sd)
            scores = {}
            for d in domain_names:
                va = (split == 'val') & (domains == d)
                pred = (x[va] @ w.T + b).argmax(1)
                scores[d] = float(f1_score(y[va], pred, labels=supported[d],
                                          average='macro', zero_division=0))
            score = float(np.mean(list(scores.values())))
            row = dict(mode=mode, C=c, val_score=score, val_macro_f1=scores)
            print(row, flush=True)
            grid.append(row)
            if best is None or score > best['val_score']:
                best = row | dict(weight=w, bias=b)
    return best, grid
