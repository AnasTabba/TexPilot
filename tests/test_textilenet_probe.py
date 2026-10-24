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
