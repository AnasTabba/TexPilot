"""anomalib PatchCore and Reverse Distillation behind the bench ``Method`` protocol.

anomalib and lightning are imported inside the methods: they are installed on Kaggle only.
Source checked: anomalib 2.7.x, paths below are relative to ``src/anomalib/``.
"""

from __future__ import annotations

import tempfile

import numpy as np
import torch
import torch.nn.functional as F  # noqa: N812
from torch import nn
from torch.utils.data import DataLoader
from torchvision.transforms.v2 import Compose, Normalize, Resize

from training.fault.bench import TILE

MEAN = (0.485, 0.456, 0.406)
STD = (0.229, 0.224, 0.225)


def _subsample(tiles: list[np.ndarray], max_tiles: int, seed: int) -> list[np.ndarray]:
    if len(tiles) <= max_tiles:
        return tiles
    idx = np.sort(np.random.default_rng(seed).choice(len(tiles), size=max_tiles, replace=False))
    return [tiles[int(i)] for i in idx]


def _tile_to_chw(tile: np.ndarray) -> torch.Tensor:
    if tile.shape != (TILE, TILE, 3):
        raise ValueError(f"expected a {TILE}x{TILE}x3 tile, got {tile.shape}")
    return torch.from_numpy(np.ascontiguousarray(tile)).permute(2, 0, 1).float().div(255.0)


def _transform(size: int) -> Compose:
    # Same ops as anomalib's default pre-processor (patchcore/lightning_model.py:223-226,
    # components/base/anomalib_module.py:402-405). Used for scoring; fit gets it from anomalib
    # (PreProcessor runs it per batch as a Lightning callback,
    # pre_processing/pre_processor.py:101-111).
    return Compose([Resize((size, size), antialias=True), Normalize(mean=MEAN, std=STD)])


def _fit(
    model: nn.Module,
    tiles: list[np.ndarray],
    batch_size: int,
    max_epochs: int,
    seed: int,
    device: torch.device | None = None,
) -> None:
    from anomalib.data import ImageBatch, ImageItem  # noqa: PLC0415
    from anomalib.engine import Engine  # noqa: PLC0415
    from lightning import seed_everything  # noqa: PLC0415
    from lightning.pytorch.strategies import SingleDeviceStrategy  # noqa: PLC0415

    seed_everything(seed)
    items = [ImageItem(image=_tile_to_chw(t)) for t in tiles]
    # collate_fn as in anomalib's own tests:
    # tests/unit/models/image/mh_patchcore/test_lightning_model.py:82
    loader = DataLoader(items, batch_size=batch_size, shuffle=False, collate_fn=ImageBatch.collate)
    with tempfile.TemporaryDirectory() as root:
        # barebones=True: no ModelCheckpoint and no logger (engine/engine.py:376-377 skips the auto
        # checkpoint when barebones is set). Engine forwards kwargs to Trainer (engine.py:157-175).
        engine = Engine(
            accelerator=("gpu" if device.type == "cuda" else device.type) if device else "auto",
            devices=1,
            strategy=SingleDeviceStrategy(device=device) if device else "auto",
            max_epochs=max_epochs,
            barebones=True,
            logger=False,
            default_root_dir=root,
        )
        engine.fit(model=model, train_dataloaders=loader)  # engine/engine.py:424 (fit signature)


def _score(
    net: nn.Module,
    tiles: list[np.ndarray],
    transform: Compose,
    batch_size: int,
    device: torch.device,
) -> list[np.ndarray]:
    net = net.to(device).eval()
    maps: list[np.ndarray] = []
    with torch.no_grad():
        for start in range(0, len(tiles), batch_size):
            x = torch.stack([_tile_to_chw(t) for t in tiles[start : start + batch_size]])
            out = net(transform(x).to(device))  # eval forward returns InferenceBatch
            amap = F.interpolate(
                out.anomaly_map,
                size=(TILE, TILE),
                mode="bilinear",
                align_corners=False,
            )
            maps.extend(m[0].float().cpu().numpy() for m in amap)
    return maps


class PatchCore:
    name = "patchcore"

    def __init__(
        self,
        max_train_tiles: int = 2000,
        batch_size: int = 8,
        coreset_sampling_ratio: float = 0.1,
        device: str | torch.device | None = None,
        seed: int = 2026,
    ) -> None:
        self.max_train_tiles = max_train_tiles
        self.batch_size = batch_size
        self.coreset_sampling_ratio = coreset_sampling_ratio
        self.device = torch.device(device) if device is not None else None
        self.seed = seed
        self._model = None

    def fit(self, train: list[np.ndarray]) -> None:
        from anomalib.models import Patchcore  # noqa: PLC0415
        from lightning import seed_everything  # noqa: PLC0415

        seed_everything(self.seed)  # Seed decoder/coreset initialization before construction.
        tiles = _subsample(train, self.max_train_tiles, self.seed)
        if len(tiles) < len(train):
            print(f"{self.name}: kept {len(tiles)} of {len(train)} train tiles (seed {self.seed})")
        # Constructor: models/image/patchcore/lightning_model.py:141-153 (pre_processor and
        # post_processor accept an instance or a bool). Pre-processor: lines 182-228.
        model = Patchcore(
            coreset_sampling_ratio=self.coreset_sampling_ratio,
            pre_processor=Patchcore.configure_pre_processor(image_size=(TILE, TILE)),
            post_processor=False,
            evaluator=False,
            visualizer=False,
        )
        _fit(model, tiles, self.batch_size, max_epochs=1, seed=self.seed, device=self.device)
        self._model = model

    def score_tiles(self, tiles: list[np.ndarray]) -> list[np.ndarray]:
        if self._model is None:
            raise RuntimeError("call fit before score_tiles")
        device = self.device or self._model.device
        return _score(self._model.model, tiles, _transform(TILE), self.batch_size, device)


class ReverseDistillation:
    name = "reverse_distillation"

    def __init__(
        self,
        epochs: int = 50,
        batch_size: int = 16,
        input_size: int = 384,
        device: str | torch.device | None = None,
        seed: int = 2026,
    ) -> None:
        self.epochs = epochs
        self.batch_size = batch_size
        self.input_size = input_size
        self.device = torch.device(device) if device is not None else None
        self.seed = seed
        self._model = None

    def fit(self, train: list[np.ndarray]) -> None:
        from anomalib.models import ReverseDistillation as AnomalibRD  # noqa: PLC0415
        from lightning import seed_everything  # noqa: PLC0415

        seed_everything(self.seed)  # The decoder and bottleneck are randomly initialized.
        # Input size is read from pre_processor.transform
        # (components/base/anomalib_module.py:530-546).
        # The model raises if it is None (reverse_distillation/lightning_model.py:104-106).
        size = (self.input_size, self.input_size)
        model = AnomalibRD(
            pre_processor=AnomalibRD.configure_pre_processor(image_size=size),
            post_processor=False,
            evaluator=False,
            visualizer=False,
        )
        # No validation loop: training data has no anomalies. Optimizer: lightning_model.py:122-132.
        # training_step: lines 134-153. trainer_arguments (lines 176-178) has no max_epochs,
        # so ours applies.
        _fit(
            model,
            train,
            self.batch_size,
            max_epochs=self.epochs,
            seed=self.seed,
            device=self.device,
        )
        self._model = model

    def score_tiles(self, tiles: list[np.ndarray]) -> list[np.ndarray]:
        if self._model is None:
            raise RuntimeError("call fit before score_tiles")
        device = self.device or self._model.device
        transform = _transform(self.input_size)
        return _score(self._model.model, tiles, transform, self.batch_size, device)
