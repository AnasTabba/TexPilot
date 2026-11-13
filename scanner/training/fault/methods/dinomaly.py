"""Dinomaly (official repo, pinned commit) behind the bench `Method` protocol.

The repo is never imported at module level: legacy imports are scoped to its checkout.
Model build and training follow dinomaly_mvtec_uni.py (lines 104-195 of the pinned commit).
"""

from __future__ import annotations

import math
import os
import shutil
import subprocess
import tempfile
import time
from collections.abc import Iterator
from contextlib import contextmanager, nullcontext
from functools import partial
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

from ._upstream import upstream_repo

TILE = 392
IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)
P_FINAL = 0.9


@contextmanager
def _chdir(path: str) -> Iterator[None]:
    old = os.getcwd()
    os.chdir(path)
    try:
        yield
    finally:
        os.chdir(old)


class Dinomaly:
    def __init__(
        self,
        repo_dir: str,
        backbone: str = "dinov2reg_vit_base_14",
        iters: int = 10000,
        batch_size: int = 16,
        device: str | None = None,
        seed: int = 2026,
        amp: bool = False,
        gpus: int = 1,
    ) -> None:
        if gpus not in (1, 2) or batch_size <= 0 or iters <= 0:
            raise ValueError("gpus must be 1 or 2; batch_size and iters must be positive")
        if batch_size % gpus:
            raise ValueError("global batch size must divide evenly across GPUs")
        self.gpus = gpus
        self.repo_dir = str(Path(repo_dir).resolve())
        self.backbone = backbone
        self.iters = iters
        self.batch_size = batch_size
        self.device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
        self.seed = seed
        self.amp = amp
        # vitb / vits / vitl from "dinov2reg_vit_base_14" etc.
        self.name = f"dinomaly_vit{backbone.split('_')[-2][0]}"
        self._model: nn.Module | None = None
        self._trainable: nn.ModuleList | None = None

    # ---- repo access -------------------------------------------------------------------------

    def _build(self) -> tuple[nn.Module, nn.ModuleList]:
        """Rebuild the model as dinomaly_mvtec_uni.py does; returns (model, trainable)."""
        with upstream_repo(self.repo_dir):
            from dinov1.utils import trunc_normal_
            from models.uad import ViTill
            from models.vision_transformer import Block as VitBlock
            from models.vision_transformer import LinearAttention2, bMlp

            class FullPrecisionAttention(LinearAttention2):
                def forward(self, x, attn_mask=None):
                    # The repo's unnormalised linear-attention contractions overflow FP16.
                    with torch.autocast(device_type=x.device.type, enabled=False):
                        return super().forward(x.float(), attn_mask=attn_mask)

            arch = self.backbone.split("_")[-2]
            if arch == "small":
                embed_dim, num_heads = 384, 6
            elif arch == "base":
                embed_dim, num_heads = 768, 12
            elif arch == "large":
                embed_dim, num_heads = 1024, 16
            else:
                raise ValueError(f"unknown Dinomaly backbone size: {arch}")
            target_layers = [2, 3, 4, 5, 6, 7, 8, 9]
            if arch == "large":
                target_layers = [4, 6, 8, 10, 12, 14, 16, 18]
            fuse = [[0, 1, 2, 3], [4, 5, 6, 7]]

            # vit_encoder creates and downloads into backbones/weights relative to the cwd.
            with _chdir(self.repo_dir):
                from models import vit_encoder

                encoder = vit_encoder.load(self.backbone)
            encoder.requires_grad_(False)

            bottleneck = nn.ModuleList([bMlp(embed_dim, embed_dim * 4, embed_dim, drop=0.2)])
            decoder = nn.ModuleList(
                [
                    VitBlock(
                        dim=embed_dim,
                        num_heads=num_heads,
                        mlp_ratio=4.0,
                        qkv_bias=True,
                        norm_layer=partial(nn.LayerNorm, eps=1e-8),
                        attn=FullPrecisionAttention if self.amp else LinearAttention2,
                    )
                    for _ in range(8)
                ]
            )
            model = ViTill(
                encoder=encoder,
                bottleneck=bottleneck,
                decoder=decoder,
                target_layers=target_layers,
                mask_neighbor_size=0,
                fuse_layer_encoder=fuse,
                fuse_layer_decoder=fuse,
            ).to(self.device)
            trainable = nn.ModuleList([bottleneck, decoder])

            for m in trainable.modules():
                if isinstance(m, nn.Linear):
                    trunc_normal_(m.weight, std=0.01, a=-0.03, b=0.03)
                    if m.bias is not None:
                        nn.init.constant_(m.bias, 0)
                elif isinstance(m, nn.LayerNorm):
                    nn.init.constant_(m.bias, 0)
                    nn.init.constant_(m.weight, 1.0)
            return model, trainable

    def _repo_commit(self) -> str | None:
        out = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=self.repo_dir, capture_output=True, text=True
        )
        return out.stdout.strip() if out.returncode == 0 else None

    # ---- data and helpers --------------------------------------------------------------------

    def _to_tensor(self, batch: list[np.ndarray]) -> torch.Tensor:
        if any(t.shape != (TILE, TILE, 3) for t in batch):
            raise ValueError(f"Dinomaly expects {TILE}x{TILE}x3 tiles")
        x = torch.from_numpy(np.stack(batch)).to(self.device)  # uint8 on device, per batch
        x = x.permute(0, 3, 1, 2).float().div_(255.0)
        mean = torch.tensor(IMAGENET_MEAN, device=self.device).view(1, 3, 1, 1)
        std = torch.tensor(IMAGENET_STD, device=self.device).view(1, 3, 1, 1)
        return (x - mean) / std

    def _autocast(self):
        if self.amp and self.device.type == "cuda":
            return torch.autocast("cuda", dtype=torch.float16)
        return nullcontext()

    # ---- Method protocol ---------------------------------------------------------------------

    def fit(self, train: list[np.ndarray]) -> None:
        if self.gpus == 1:
            return self._fit_loop(train)
        if len(train) == 0:
            raise ValueError("fit needs at least one training tile")
        if self.device.type != "cuda" or torch.cuda.device_count() < 2:
            raise RuntimeError("two-GPU fit requires two visible CUDA devices")
        required_disk = len(train) * TILE * TILE * 3 + 6 * 1024**3
        if shutil.disk_usage(tempfile.gettempdir()).free < required_disk:
            raise RuntimeError("insufficient temporary filesystem space for DDP tiles/checkpoint")
        # Spawn fresh interpreters: upstream import caches/cwd/locks are process-local.
        # File-backed tiles avoid pickling or duplicating the full uint8 dataset per rank.
        with tempfile.TemporaryDirectory(prefix="dinomaly-ddp-") as directory:
            folder = Path(directory)
            tiles = np.lib.format.open_memmap(
                folder / "tiles.npy",
                mode="w+",
                dtype=np.uint8,
                shape=(len(train), TILE, TILE, 3),
            )
            for i, tile in enumerate(train):
                if tile.shape != (TILE, TILE, 3) or tile.dtype != np.uint8:
                    raise ValueError("Dinomaly requires uint8 392-square RGB tiles")
                tiles[i] = tile
            tiles.flush()
            del tiles
            config = dict(
                repo_dir=self.repo_dir,
                backbone=self.backbone,
                iters=self.iters,
                batch_size=self.batch_size,
                seed=self.seed,
                amp=self.amp,
            )
            from torch.multiprocessing import spawn

            spawn(_ddp_fit_worker, args=(config, str(folder)), nprocs=2, join=True)
            checkpoint = torch.load(folder / "rank0.pt", map_location="cpu", weights_only=True)
            self._model, self._trainable = self._build()
            self._trainable.load_state_dict(checkpoint["state_dict"])
            self.fit_loop_seconds = checkpoint["fit_loop_seconds"]
            self.training_provenance = checkpoint["training_provenance"]

    def _fit_loop(self, train, rank=0, world_size=1):
        with upstream_repo(self.repo_dir):
            if len(train) == 0:
                raise ValueError("fit needs at least one training tile")
            from optimizers import StableAdamW
            from utils import WarmCosineScheduler, global_cosine_hm_percent

            torch.manual_seed(self.seed)
            model, trainable = self._build()
            model.train()
            model.encoder.eval()  # frozen encoder; bottleneck and decoder train
            unwrapped = model
            if world_size > 1:
                from torch.nn.parallel import DistributedDataParallel

                model = DistributedDataParallel(model, device_ids=[rank], broadcast_buffers=False)
            # Initialization is identical across ranks. Stochastic layers use deterministic
            # rank-derived streams; DDP is not bitwise identical to single-device dropout.
            if world_size > 1:
                torch.manual_seed(self.seed + rank)

            opt = StableAdamW(
                [{"params": trainable.parameters()}],
                lr=2e-3,
                betas=(0.9, 0.999),
                weight_decay=1e-4,
                amsgrad=True,
                eps=1e-10,
            )
            sched = WarmCosineScheduler(
                opt, base_value=2e-3, final_value=2e-4, total_iters=self.iters, warmup_iters=100
            )
            amp_on = self.amp and self.device.type == "cuda"
            if hasattr(torch.amp, "GradScaler"):  # torch >= 2.3
                scaler = torch.amp.GradScaler("cuda", enabled=amp_on)
            else:  # Kaggle's pinned torch 1.12
                scaler = torch.cuda.amp.GradScaler(enabled=amp_on)
            rng = np.random.default_rng(self.seed)
            n, bs = len(train), self.batch_size
            window: list[float] = []

            if self.device.type == "cuda":
                torch.cuda.synchronize(self.device)
            fit_started = time.perf_counter()
            it = attempts = skipped = 0
            while it < self.iters:
                attempts += 1
                sampling_state = rng.bit_generator.state
                idx = rng.choice(n, size=bs, replace=n < bs)
                if world_size > 1:
                    idx = np.array_split(idx, world_size)[rank]
                x = self._to_tensor([train[i] for i in idx])
                with self._autocast():
                    en, de = model(x)
                    p = min(P_FINAL * it / 1000, P_FINAL)
                    loss = (
                        distributed_cosine_hm_percent(en, de, p=p, factor=0.1)
                        if world_size > 1
                        else global_cosine_hm_percent(en, de, p=p, factor=0.1)
                    )
                logged_loss = loss.detach().float().clone()
                if world_size > 1:
                    torch.distributed.all_reduce(logged_loss)
                    logged_loss /= world_size
                value = logged_loss.item()
                if not math.isfinite(value):
                    raise RuntimeError(f"non-finite loss {value} at iteration {it}")

                opt.zero_grad()
                scaler.scale(loss).backward()
                scaler.unscale_(opt)
                norm = nn.utils.clip_grad_norm_(trainable.parameters(), max_norm=0.1)
                finite = torch.tensor(int(torch.isfinite(norm)), device=self.device)
                if world_size > 1:
                    torch.distributed.all_reduce(finite, op=torch.distributed.ReduceOp.MIN)
                if not finite.item():
                    if not amp_on or skipped >= 100:
                        raise RuntimeError("nonfinite gradients or repeated AMP overflows")
                    scaler.update(new_scale=scaler.get_scale() / 2)
                    skipped += 1
                    # Retry the same global sample; scheduler/hard mining count successful steps.
                    rng.bit_generator.state = sampling_state
                    continue
                scaler.step(opt)
                scaler.update()
                sched.step()

                if it + 1 == 50 or it + 1 == self.iters:
                    if self.device.type == "cuda":
                        torch.cuda.synchronize(self.device)
                    elapsed = time.perf_counter() - fit_started
                    print(
                        f"FIT_TIMING amp={self.amp} iterations={it + 1} "
                        f"seconds_per_iteration={elapsed / (it + 1):.6f}",
                        flush=True,
                    )
                it += 1
                window.append(value)
                if it % 500 == 0 and rank == 0:
                    print(f"iter [{it}/{self.iters}], loss:{np.mean(window):.4f}", flush=True)
                    window.clear()

            self.fit_loop_seconds = time.perf_counter() - fit_started
            print(f"FIT_TOTAL amp={self.amp} seconds={self.fit_loop_seconds:.6f}", flush=True)
            self._model, self._trainable = unwrapped, trainable
            self.training_provenance = {
                "world_size": world_size,
                "global_batch_size": bs,
                "local_batch_size": bs // world_size,
                "optimizer_steps": it,
                "attempts": attempts,
                "skipped_updates": skipped,
                "seed": self.seed,
                "rank_dropout_seeds": [self.seed + r for r in range(world_size)],
                "global_hard_mining": True,
            }

    def score_tiles(self, tiles: list[np.ndarray]) -> list[np.ndarray]:
        with upstream_repo(self.repo_dir):
            if self._model is None:
                raise RuntimeError("call fit() or load() before score_tiles()")
            from utils import cal_anomaly_maps, get_gaussian_kernel

            model = self._model
            model.eval()
            gaussian = get_gaussian_kernel(kernel_size=5, sigma=4).to(self.device)
            maps: list[np.ndarray] = []
            with torch.no_grad(), self._autocast():
                for start in range(0, len(tiles), self.batch_size):
                    x = self._to_tensor(tiles[start : start + self.batch_size])
                    en, de = model(x)
                    amap, _ = cal_anomaly_maps(en, de, TILE)
                    amap = gaussian(amap.float())
                    maps.extend(amap[:, 0].float().cpu().numpy())
            return maps

    def save(self, path: str | Path) -> None:
        if self._trainable is None:
            raise RuntimeError("nothing to save: call fit() or load() first")
        torch.save(
            {
                "state_dict": self._trainable.state_dict(),
                "backbone": self.backbone,
                "repo_commit": self._repo_commit(),
                "training_provenance": getattr(self, "training_provenance", {}),
            },
            path,
        )

    def load(self, path: str | Path) -> None:
        ckpt = torch.load(path, map_location="cpu")
        if ckpt["backbone"] != self.backbone:
            raise ValueError(f"checkpoint is for {ckpt['backbone']}, not {self.backbone}")
        if self._trainable is None:
            self._model, self._trainable = self._build()
        self._trainable.load_state_dict(ckpt["state_dict"])
        self.training_provenance = ckpt.get("training_provenance", {})


def distributed_cosine_hm_percent(a, b, p=0.9, factor=0.0):
    """Upstream loss with a global hard-mining threshold and DDP-averaged gradients.

    Equal local batch sizes are required. Only detached point distances communicate;
    the scalar image-cosine loss stays local, and DDP averages parameter gradients.
    """
    import torch.distributed as dist

    cos = nn.CosineSimilarity()
    loss = 0
    for encoder, decoder in zip(a, b, strict=True):
        encoder = encoder.detach()
        with torch.no_grad():
            distance = 1 - cos(encoder, decoder).unsqueeze(1)
            pieces = [torch.empty_like(distance) for _ in range(dist.get_world_size())]
            dist.all_gather(pieces, distance.contiguous())
            points = torch.cat(pieces).reshape(-1)
            threshold = torch.topk(points, k=int(points.numel() * (1 - p)))[0][-1]
            easy = distance < threshold
        loss += (
            1 - cos(encoder.reshape(encoder.shape[0], -1), decoder.reshape(decoder.shape[0], -1))
        ).mean()

        def modify(gradient, mask=easy):
            return torch.where(mask.expand_as(gradient), gradient * factor, gradient)

        decoder.register_hook(modify)
    return loss / len(a)


def _ddp_fit_worker(rank, config, directory):
    import torch.distributed as dist

    torch.cuda.set_device(rank)
    folder = Path(directory)
    dist.init_process_group(
        "nccl", init_method=(folder / "rendezvous").as_uri(), rank=rank, world_size=2
    )
    try:
        method = Dinomaly(**config, device=f"cuda:{rank}")
        train = np.load(folder / "tiles.npy", mmap_mode="r")
        torch.cuda.reset_peak_memory_stats(rank)
        print(
            f"DDP rank={rank} device={torch.cuda.get_device_name(rank)} "
            f"global_batch={method.batch_size} local_batch={method.batch_size // 2}",
            flush=True,
        )
        method._fit_loop(train, rank=rank, world_size=2)
        print(f"DDP rank={rank} allocated_peak={torch.cuda.max_memory_allocated(rank)}", flush=True)
        if rank == 0:
            torch.save(
                {
                    "state_dict": method._trainable.state_dict(),
                    "fit_loop_seconds": method.fit_loop_seconds,
                    "training_provenance": method.training_provenance,
                },
                folder / "rank0.pt",
            )
    finally:
        dist.destroy_process_group()
