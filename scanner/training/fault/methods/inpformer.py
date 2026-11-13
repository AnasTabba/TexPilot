"""INP-Former (official code) behind the bench `Method` protocol.

Model code comes from the official repo, imported lazily from `repo_dir` (models.*, optimizers.*).
Training follows INP_Former_Multi_Class.py main(): same modules, optimiser, scheduler, loss, clip.
Differences are listed in the report and marked in the code.

Copied, not imported, from the repo's utils.py (utils.py imports kornia, adeval and aug_funcs at
module level, which are not installed here). Source: https://github.com/luow23/INP-Former at commit
17d265381d9b323a2ef6e05aab0665a85edebe84. Copyright (c) 2025 Wei Luo, MIT licence (see the repo's
LICENSE). Zero mean distance is guarded to avoid NaN gradient hooks; otherwise maths
unchanged, with commented-out lines dropped.
  modify_grad_v2               utils.py 125-128   (used by global_cosine_hm_adaptive)
  global_cosine_hm_adaptive    utils.py 130-151
  cal_anomaly_maps             utils.py 153-168
  get_gaussian_kernel          utils.py 386-419
  WarmCosineScheduler          utils.py 424-441   (_LRScheduler import at utils.py 421)
"""

from __future__ import annotations

import math
import os
import subprocess
from functools import partial
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.nn.init import trunc_normal_
from torch.optim.lr_scheduler import _LRScheduler

from ._upstream import upstream_repo

TILE = 392
_MEAN = (0.485, 0.456, 0.406)
_STD = (0.229, 0.224, 0.225)
_DIMS = {"small": (384, 6), "base": (768, 12)}  # embed_dim, num_heads (as in main())
_TARGET_LAYERS = [2, 3, 4, 5, 6, 7, 8, 9]
_FUSE_ENCODER = [[0, 1, 2, 3], [4, 5, 6, 7]]
_FUSE_DECODER = [[0, 1, 2, 3], [4, 5, 6, 7]]


# ---- copied from the INP-Former repo (see module docstring) ----------------------------------

def modify_grad_v2(x, factor):
    factor = factor.expand_as(x)
    x *= factor
    return x


def global_cosine_hm_adaptive(a, b, y=3):
    cos_loss = torch.nn.CosineSimilarity()
    loss = 0
    for item in range(len(a)):
        a_ = a[item].detach()
        b_ = b[item]
        with torch.no_grad():
            point_dist = 1 - cos_loss(a_, b_).unsqueeze(1).detach()
        mean_dist = point_dist.mean()
        # Exact reconstruction has zero distance: avoid 0/0 in the backward hook.
        denominator = torch.where(mean_dist == 0, torch.ones_like(mean_dist), mean_dist)
        factor = (point_dist / denominator) ** (y)
        loss += torch.mean(1 - cos_loss(a_.reshape(a_.shape[0], -1),
                                        b_.reshape(b_.shape[0], -1)))
        partial_func = partial(modify_grad_v2, factor=factor)
        b_.register_hook(partial_func)

    loss = loss / len(a)
    return loss


def cal_anomaly_maps(fs_list, ft_list, out_size=224):
    if not isinstance(out_size, tuple):
        out_size = (out_size, out_size)

    a_map_list = []
    for i in range(len(ft_list)):
        fs = fs_list[i]
        ft = ft_list[i]
        a_map = 1 - F.cosine_similarity(fs, ft)
        a_map = torch.unsqueeze(a_map, dim=1)
        a_map = F.interpolate(a_map, size=out_size, mode='bilinear', align_corners=True)
        a_map_list.append(a_map)
    anomaly_map = torch.cat(a_map_list, dim=1).mean(dim=1, keepdim=True)
    return anomaly_map, a_map_list


def get_gaussian_kernel(kernel_size=3, sigma=2, channels=1):
    x_coord = torch.arange(kernel_size)
    x_grid = x_coord.repeat(kernel_size).view(kernel_size, kernel_size)
    y_grid = x_grid.t()
    xy_grid = torch.stack([x_grid, y_grid], dim=-1).float()

    mean = (kernel_size - 1) / 2.
    variance = sigma ** 2.

    gaussian_kernel = (1. / (2. * math.pi * variance)) * \
                      torch.exp(
                          -torch.sum((xy_grid - mean) ** 2., dim=-1) / \
                          (2 * variance)
                      )

    gaussian_kernel = gaussian_kernel / torch.sum(gaussian_kernel)

    gaussian_kernel = gaussian_kernel.view(1, 1, kernel_size, kernel_size)
    gaussian_kernel = gaussian_kernel.repeat(channels, 1, 1, 1)

    gaussian_filter = torch.nn.Conv2d(in_channels=channels, out_channels=channels,
                                      kernel_size=kernel_size, groups=channels,
                                      bias=False, padding=kernel_size // 2)

    gaussian_filter.weight.data = gaussian_kernel
    gaussian_filter.weight.requires_grad = False

    return gaussian_filter


class WarmCosineScheduler(_LRScheduler):

    def __init__(self, optimizer, base_value, final_value, total_iters, warmup_iters=0,
                 start_warmup_value=0):
        self.final_value = final_value
        self.total_iters = total_iters
        warmup_schedule = np.linspace(start_warmup_value, base_value, warmup_iters)

        iters = np.arange(total_iters - warmup_iters)
        schedule = final_value + 0.5 * (base_value - final_value) * (
            1 + np.cos(np.pi * iters / len(iters)))
        self.schedule = np.concatenate((warmup_schedule, schedule))

        super().__init__(optimizer)

    def get_lr(self):
        if self.last_epoch >= self.total_iters:
            return [self.final_value for base_lr in self.base_lrs]
        else:
            return [self.schedule[self.last_epoch] for base_lr in self.base_lrs]


# ---- wrapper ---------------------------------------------------------------------------------

def _to_tensor(tiles: np.ndarray, device: str) -> torch.Tensor:
    """uint8 N×H×W×3 → normalised float N×3×H×W (ToTensor + Normalize, no resize or crop)."""
    x = torch.as_tensor(tiles).to(device).permute(0, 3, 1, 2).float() / 255.0
    mean = torch.tensor(_MEAN, device=device).view(1, 3, 1, 1)
    std = torch.tensor(_STD, device=device).view(1, 3, 1, 1)
    return (x - mean) / std


def _repo_commit(repo: Path) -> str:
    try:
        out = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"],
                             capture_output=True, text=True, check=True)
        return out.stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


class INPFormer:
    """Trains INP-Former on good tiles (one unified model) and scores tiles by anomaly map."""

    def __init__(self, repo_dir: str, backbone: str = "dinov2reg_vit_base_14", iters: int = 10000,
                 batch_size: int = 16, inp_num: int = 6, device: str | None = None,
                 seed: int = 2026) -> None:
        size = next((s for s in _DIMS if s in backbone), None)
        if size is None:
            raise ValueError(f"backbone must name small or base, got {backbone!r}")
        self.name = "inpformer_vit" + size[0]  # inpformer_vitb / inpformer_vits
        self._dims = _DIMS[size]
        self.repo_dir = str(Path(repo_dir).resolve())
        self.backbone = backbone
        if iters <= 0 or batch_size <= 0 or inp_num <= 0:
            raise ValueError("iters, batch_size and inp_num must be positive")
        self.iters = iters
        self.batch_size = batch_size
        self.inp_num = inp_num
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.seed = seed
        self.repo_commit = _repo_commit(Path(repo_dir))
        self.model: nn.Module | None = None
        self.trainable: nn.Module | None = None

    # building

    def _load_encoder(self):
        repo = Path(self.repo_dir)
        if not (repo / "models" / "vit_encoder.py").is_file():
            raise FileNotFoundError(f"INP-Former repo not found at {repo}")
        with upstream_repo(repo):
            cwd = os.getcwd()
            os.chdir(repo)  # vit_encoder writes weights relative to cwd
            try:
                from models import vit_encoder

                return vit_encoder.load(self.backbone)
            finally:
                os.chdir(cwd)

    def _assemble(self, encoder):
        """Same modules, order and init as main() in INP_Former_Multi_Class.py."""
        with upstream_repo(self.repo_dir):
            from models.uad import INP_Former
            from models.vision_transformer import Aggregation_Block, Mlp, Prototype_Block

        embed_dim, num_heads = self._dims
        encoder.requires_grad_(False)  # frozen; main() only ran it under no_grad
        norm = partial(nn.LayerNorm, eps=1e-8)

        bottleneck = nn.ModuleList([Mlp(embed_dim, embed_dim * 4, embed_dim, drop=0.)])
        inp = nn.ParameterList(
            [nn.Parameter(torch.randn(self.inp_num, embed_dim)) for _ in range(1)])
        extractor = nn.ModuleList([
            Aggregation_Block(dim=embed_dim, num_heads=num_heads, mlp_ratio=4.,
                              qkv_bias=True, norm_layer=norm)
            for _ in range(1)])
        decoder = nn.ModuleList([
            Prototype_Block(dim=embed_dim, num_heads=num_heads, mlp_ratio=4.,
                            qkv_bias=True, norm_layer=norm)
            for _ in range(8)])
        model = INP_Former(encoder=encoder, bottleneck=bottleneck, aggregation=extractor,
                           decoder=decoder, target_layers=_TARGET_LAYERS, remove_class_token=True,
                           fuse_layer_encoder=_FUSE_ENCODER, fuse_layer_decoder=_FUSE_DECODER,
                           prototype_token=inp).to(self.device)

        trainable = nn.ModuleList([bottleneck, decoder, extractor, inp])
        for m in trainable.modules():
            if isinstance(m, nn.Linear):
                trunc_normal_(m.weight, std=0.01, a=-0.03, b=0.03)
                if m.bias is not None:
                    nn.init.constant_(m.bias, 0)
            elif isinstance(m, nn.LayerNorm):
                nn.init.constant_(m.bias, 0)
                nn.init.constant_(m.weight, 1.0)
        return model, trainable

    def _build(self):
        torch.manual_seed(self.seed)
        return self._assemble(self._load_encoder())

    def _optimizer(self, params: list) -> torch.optim.Optimizer:
        """StableAdamW from the repo. Tests replace this to avoid needing the clone."""
        with upstream_repo(self.repo_dir):
            from optimizers import StableAdamW

        return StableAdamW([{"params": params}], lr=1e-3, betas=(0.9, 0.999), weight_decay=1e-4,
                           amsgrad=True, eps=1e-10)

    # Method protocol

    def fit(self, train: list[np.ndarray]) -> None:
        if not train:
            raise ValueError("fit needs at least one training tile")
        self.model, self.trainable = self._build()
        tiles = np.stack(train)  # N×392×392×3 uint8, converted per batch
        n = len(tiles)
        rng = np.random.default_rng(self.seed)
        # The script trains by epochs with drop_last=True. This trains by iterations: each step
        # draws a random batch, with replacement only when there are fewer tiles than batch_size.
        optimizer = self._optimizer(list(self.trainable.parameters()))
        scheduler = WarmCosineScheduler(optimizer, base_value=1e-3, final_value=1e-4,
                                        total_iters=self.iters, warmup_iters=100)
        self.model.train()
        for it in range(self.iters):
            idx = rng.choice(n, size=self.batch_size, replace=n < self.batch_size)
            en, de, g_loss = self.model(_to_tensor(tiles[idx], self.device))
            loss = global_cosine_hm_adaptive(en, de, y=3) + 0.2 * g_loss
            if not torch.isfinite(loss):
                raise RuntimeError(f"INP-Former loss is NaN at iteration {it}")
            optimizer.zero_grad()
            loss.backward()
            # script: deprecated nn.utils.clip_grad_norm (no underscore), same behaviour
            torch.nn.utils.clip_grad_norm_(self.trainable.parameters(), max_norm=0.1)
            optimizer.step()
            scheduler.step()
            if it % 500 == 0:
                print(f"[{self.name}] iter {it}/{self.iters} loss {loss.item():.4f}")

    def score_tiles(self, tiles: list[np.ndarray]) -> list[np.ndarray]:
        if self.model is None:
            raise RuntimeError("call fit() or load() before score_tiles()")
        self.model.eval()
        kernel = get_gaussian_kernel(kernel_size=5, sigma=4).to(self.device)
        maps: list[np.ndarray] = []
        with torch.no_grad():
            for s in range(0, len(tiles), self.batch_size):
                x = _to_tensor(np.stack(tiles[s:s + self.batch_size]), self.device)
                en, de, _ = self.model(x)
                amap, _ = cal_anomaly_maps(en, de, TILE)
                amap = kernel(amap)
                maps.extend(amap[:, 0].cpu().numpy().astype(np.float32))
        return maps

    # persistence

    def save(self, path: str | Path) -> None:
        if self.trainable is None:
            raise RuntimeError("nothing to save: call fit() first")
        torch.save({"name": self.name, "backbone": self.backbone, "repo_commit": self.repo_commit,
                    "inp_num": self.inp_num, "trainable": self.trainable.state_dict()}, path)

    def load(self, path: str | Path) -> None:
        ck = torch.load(path, map_location=self.device)
        if ck["backbone"] != self.backbone:
            raise ValueError(f"checkpoint is for {ck['backbone']}, not {self.backbone}")
        if ck.get("inp_num", 6) != self.inp_num:
            raise ValueError("checkpoint prototype count differs from inp_num")
        self.model, self.trainable = self._build()
        self.trainable.load_state_dict(ck["trainable"])
        self.model.eval()
