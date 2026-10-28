"""Loss, lr schedule, class weights, head lr, TTA. Skipped where torch is absent (CI core)."""

import math

import pytest

torch = pytest.importorskip("torch")
np = pytest.importorskip("numpy")

import torch.nn.functional as F  # noqa: E402

from training.textilenet.recipe import (  # noqa: E402
    class_balance_weights,
    epoch_order,
    irus_order,
    lr_at,
    predict,
    soft_cross_entropy,
    split_head,
    tta_views,
)


def test_lr_warms_up_linearly_then_decays_to_final_on_the_last_step():
    total, warmup, base = 100, 10, 1e-3
    lrs = [lr_at(s, total, warmup, base, final=0.0) for s in range(total)]
    assert lrs[0] == pytest.approx(base / warmup)
    assert lrs[warmup - 1] == pytest.approx(base)
    assert lrs[warmup] == pytest.approx(base)  # cosine starts at the peak
    assert lrs[-1] == pytest.approx(0.0, abs=1e-12)  # fully decayed -- the baselines' bug
    after = lrs[warmup:]
    assert all(a >= b for a, b in zip(after, after[1:], strict=False))


def test_lr_without_warmup():
    assert lr_at(0, 10, 0, 1.0, final=0.0) == pytest.approx(1.0)
    assert lr_at(9, 10, 0, 1.0, final=0.0) == pytest.approx(0.0, abs=1e-12)


def test_soft_ce_matches_torch_for_hard_targets():
    torch.manual_seed(0)
    logits, y = torch.randn(16, 5), torch.randint(0, 5, (16,))
    onehot = F.one_hot(y, 5).float()
    assert soft_cross_entropy(logits, onehot) == pytest.approx(F.cross_entropy(logits, y).item())
    w = torch.tensor([0.5, 1.0, 2.0, 3.0, 0.1])
    assert soft_cross_entropy(logits, onehot, w) == pytest.approx(
        F.cross_entropy(logits, y, weight=w).item(), rel=1e-6
    )


def test_soft_ce_with_smoothing_matches_torch():
    torch.manual_seed(1)
    logits, y = torch.randn(8, 4), torch.randint(0, 4, (8,))
    smooth = F.one_hot(y, 4).float() * 0.9 + 0.1 / 4
    expected = F.cross_entropy(logits, y, label_smoothing=0.1).item()
    assert soft_cross_entropy(logits, smooth) == pytest.approx(expected, rel=1e-6)


def test_class_weights_average_one_per_sample_and_favour_rare_classes():
    targets = [0] * 90 + [1] * 10
    w = class_balance_weights(targets, 3, power=0.5)
    assert (w[np.array(targets)]).mean() == pytest.approx(1.0)
    assert w[1] / w[0] == pytest.approx(math.sqrt(9))
    assert w[2] == 0.0  # absent class
    assert np.allclose(class_balance_weights(targets, 2, power=0.0), 1.0)


def test_head_gets_the_multiplier_on_top_of_layer_decay():
    model = torch.nn.Sequential(torch.nn.Linear(4, 4), torch.nn.Linear(4, 2))
    body, head = model[0], model[1]
    groups = [
        {"params": [body.weight, head.weight], "weight_decay": 0.05, "lr_scale": 0.5},
        {"params": [body.bias, head.bias], "weight_decay": 0.0},
    ]
    out = split_head(groups, head.parameters(), head_lr_mult=10)
    scale = {id(p): g["lr_scale"] for g in out for p in g["params"]}
    assert scale[id(body.weight)] == 0.5
    assert scale[id(head.weight)] == 5.0
    assert scale[id(body.bias)] == 1.0
    assert scale[id(head.bias)] == 10.0
    assert sum(len(g["params"]) for g in out) == 4
    wd = {id(p): g["weight_decay"] for g in out for p in g["params"]}
    assert wd[id(head.bias)] == 0.0  # no-WD survives the split


def test_tta_views_are_the_orientations_and_predict_returns_log_probs():
    x = torch.arange(2 * 3 * 4 * 4, dtype=torch.float32).reshape(2, 3, 4, 4)
    views = tta_views(x)
    assert len(views) == 4
    assert torch.equal(views[1], x.flip(3))
    assert torch.equal(views[2].rot90(3, (2, 3)), x)

    model = torch.nn.Sequential(torch.nn.Flatten(), torch.nn.Linear(48, 3))
    loader = [(x, torch.tensor([0, 2]))]
    from contextlib import nullcontext

    scores, y = predict(model, loader, torch.device("cpu"), nullcontext, tta=True)
    assert scores.shape == (2, 3)
    assert np.allclose(np.exp(scores).sum(1), 1.0, atol=1e-5)
    assert y.tolist() == [0, 2]
    plain, _ = predict(model, loader, torch.device("cpu"), nullcontext, tta=False)
    assert np.allclose(plain, model(x).detach().numpy(), atol=1e-6)


def test_epoch_order_is_a_shuffle_without_a_sampler():
    y = torch.tensor([0] * 90 + [1] * 10)
    order = epoch_order(y, 2, 0.0, torch.Generator().manual_seed(0))
    assert sorted(order.tolist()) == list(range(100))


def test_sqrt_epoch_order_draws_rare_classes_at_sqrt_balanced_rates():
    y = torch.tensor([0] * 900 + [1] * 100)
    order = epoch_order(y, 2, 0.5, torch.Generator().manual_seed(0))
    assert len(order) == len(y)  # one epoch = n draws, as WeightedRandomSampler
    # weights 900^-.5 : 100^-.5 = 1/30 : 1/10 -> class-1 share 10 / (30 + 10) = .25
    assert (y[order] == 1).float().mean().item() == pytest.approx(0.25, abs=0.04)


def test_irus_cuts_big_classes_to_a_fresh_subset_each_epoch_and_keeps_views_together():
    y = torch.tensor([0] * 50 + [1] * 5)
    g = torch.Generator().manual_seed(0)
    a = irus_order(y, 2, cap=10, g=g, copies=2)
    b = irus_order(y, 2, cap=10, g=g, copies=2)
    assert len(a) == len(b) == (10 + 5) * 2
    images = a[a < 55]  # first copy (standard view); the second copy is image + 55
    assert sorted((a[a >= 55] - 55).tolist()) == sorted(images.tolist())  # both views of each
    assert (y[images] == 0).sum() == 10 and sorted(images[y[images] == 1].tolist()) == list(
        range(50, 55)
    )
    assert set(images[y[images] == 0].tolist()) != set(b[(b < 55)][y[b[b < 55]] == 0].tolist())
