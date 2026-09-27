"""Serving preprocessing must equal the transform the cached features were made with."""

import pytest

np = pytest.importorskip("numpy")
pytest.importorskip("albumentations")
pytest.importorskip("cv2")

from services.vision.backbone import preprocess  # noqa: E402
from training.textilenet.train import build_transforms  # noqa: E402

MEAN, STD = (0.485, 0.456, 0.406), (0.229, 0.224, 0.225)


@pytest.mark.parametrize("shape", [(300, 400, 3), (512, 256, 3), (224, 224, 3)])
def test_preprocess_matches_the_training_eval_transform(shape):
    img = (np.random.default_rng(0).random(shape) * 255).astype(np.uint8)
    _, eval_tf = build_transforms(224, MEAN, STD, 0.875)
    expected = eval_tf(image=img)["image"].numpy()
    got = preprocess(img, MEAN, STD)
    assert got.shape == (3, 224, 224)
    assert np.abs(got - expected).max() < 1e-4
