"""The linear-head fit on cached features. Skipped where the ML stack is absent (CI core)."""

import pytest

torch = pytest.importorskip("torch")
pytest.importorskip("timm")
pytest.importorskip("albumentations")

from training.textilenet.probe import fit_linear  # noqa: E402


def test_fit_linear_reports_every_epoch_and_learns_a_separable_problem():
    g = torch.Generator().manual_seed(0)
    y = torch.tensor([0] * 300 + [1] * 30)
    x = torch.randn(len(y), 8, generator=g) + 3 * torch.nn.functional.one_hot(y, 8).float()
    seen = []
    head = fit_linear(
        x,
        y,
        2,
        5e-2,
        1e-4,
        30,
        0,
        "cpu",
        sampler_power=0.5,
        on_epoch=lambda epoch, h, loss: seen.append((epoch, loss)),
    )
    assert [e for e, _ in seen] == list(range(30))  # one 330-row batch per epoch
    assert seen[-1][1] < seen[0][1]
    assert (head(x).argmax(1) == y).float().mean().item() > 0.95


def test_augment_4to5_gives_a_normalised_crop_that_changes_every_call():
    import numpy as np

    from training.textilenet.train import augment_4to5

    tf = augment_4to5(64, (0.5, 0.5, 0.5), (0.5, 0.5, 0.5))
    img = np.random.default_rng(0).integers(0, 255, (120, 90, 3), dtype=np.uint8)
    a, b = tf(image=img)["image"], tf(image=img)["image"]
    assert a.shape == (3, 64, 64) and not torch.equal(a, b)


def test_fit_linear_with_irus_over_two_stacked_views():
    g = torch.Generator().manual_seed(0)
    y = torch.tensor([0] * 300 + [1] * 30)
    x = torch.randn(len(y), 8, generator=g) + 3 * torch.nn.functional.one_hot(y, 8).float()
    x2, y2 = torch.cat([x, x + 0.1 * torch.randn(x.shape, generator=g)]), y.repeat(2)
    seen = []
    head = fit_linear(
        x2, y2, 2, 5e-2, 1e-4, 30, 0, "cpu", irus_cap=60, copies=2,
        on_epoch=lambda epoch, h, loss: seen.append(loss),
    )  # fmt: skip
    assert len(seen) == 30 and seen[-1] < seen[0]
    assert (head(x).argmax(1) == y).float().mean().item() > 0.95


def test_fp16_overflow_switches_the_encoder_to_fp32_instead_of_returning_inf(monkeypatch):
    from training.textilenet import probe

    def fake_pool(model, x):  # e.g. DINOv3: activations past the fp16 range
        if x.dtype == torch.float16:
            return torch.full((len(x), 2), float("inf"), dtype=torch.float16)
        return torch.ones(len(x), 2)

    monkeypatch.setattr(probe, "pool", fake_pool)
    model = torch.nn.Linear(2, 2).half()
    f, half = probe.pooled(model, torch.zeros(3, 2), half=True)
    assert torch.isfinite(f).all() and not half and model.weight.dtype == torch.float32
