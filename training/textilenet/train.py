#!/usr/bin/env python3
"""Fine-tune an ImageNet/SSL-pretrained backbone on a TextileNet partition.

Beats the published baselines by fixing what they left on the table: they trained
ResNet-18 / ViT-Tiny from scratch, without input normalisation, with a cosine
schedule that never decayed, and selected their checkpoint on the test set.

    python -m training.textilenet.train --partition fabric --model convnextv2_base --seed 0

Model selection and early stopping use the val carve-out only. Test is evaluated
once, at the end, with the weights (raw vs EMA) and TTA setting that won on val.

Outputs go to runs/<partition>/<model>/seed<k>/: config.json, log.jsonl, best.pt,
test_metrics.json, confusion.png. Summarise with ``training.textilenet.aggregate``.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import platform
import random
import subprocess
import sys
import time
from collections import Counter
from contextlib import nullcontext
from pathlib import Path

import albumentations as A
import cv2
import numpy as np
import timm
import torch
import torch.nn.functional as F
from albumentations.pytorch import ToTensorV2
from PIL import Image, ImageFile
from torch.utils.data import DataLoader, Dataset, WeightedRandomSampler

from training.textilenet.metrics import summarize
from training.textilenet.splits import Record, class_index, read_csv

ImageFile.LOAD_TRUNCATED_IMAGES = True  # some TextileNet JPEGs are cut short
cv2.setNumThreads(0)  # DataLoader workers already parallelise; avoid oversubscription

#: Short names -> timm weights + per-model defaults. Any other timm name also works.
PRESETS: dict[str, dict] = {
    # CNN with IN-22k pretraining: strong on texture. Primary candidate.
    "convnextv2_base": dict(
        timm_name="convnextv2_base.fcmae_ft_in22k_in1k", layer_decay=None, drop_path=0.2
    ),
    "convnextv2_base_384": dict(
        timm_name="convnextv2_base.fcmae_ft_in22k_in1k_384",
        layer_decay=None,
        drop_path=0.2,
        img_size=384,
    ),
    # Self-supervised features transfer well to fine-grained material/texture tasks.
    "dinov2_vitb14": dict(
        timm_name="vit_base_patch14_dinov2.lvd142m", layer_decay=0.75, drop_path=0.1
    ),
    "eva02_base": dict(
        timm_name="eva02_base_patch14_224.mim_in22k", layer_decay=0.75, drop_path=0.1
    ),
    # Ablation: the baseline's own architecture, pretrained, with this recipe.
    "vit_tiny": dict(
        timm_name="vit_tiny_patch16_224.augreg_in21k_ft_in1k", layer_decay=0.75, drop_path=0.1
    ),
}


# ---------------------------------------------------------------------------- data


def build_transforms(size: int, mean, std, crop_pct: float) -> tuple[A.Compose, A.Compose]:
    """Geometry heavy, colour light: texture is orientation-invariant, colour is signal."""
    mean, std = tuple(mean), tuple(std)
    train = A.Compose(
        [
            A.RandomResizedCrop(size=(size, size), scale=(0.35, 1.0)),
            A.HorizontalFlip(),
            A.VerticalFlip(),
            A.RandomRotate90(),
            # Reflect, not constant: black corners are a spurious cue on texture crops.
            A.Affine(rotate=(-20, 20), shear=(-8, 8), border_mode=cv2.BORDER_REFLECT_101, p=0.4),
            A.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.15, hue=0.02, p=0.6),
            A.OneOf(
                [
                    A.GaussianBlur(blur_limit=(3, 5)),
                    A.GaussNoise(),
                    A.ImageCompression(quality_range=(60, 95)),
                ],
                p=0.3,
            ),
            A.CLAHE(p=0.1),
            A.CoarseDropout(
                num_holes_range=(1, 6),
                hole_height_range=(0.05, 0.15),
                hole_width_range=(0.05, 0.15),
                p=0.3,
            ),
            A.Normalize(mean=mean, std=std),
            ToTensorV2(),
        ]
    )
    evaluate = A.Compose(
        [
            A.SmallestMaxSize(max_size=int(round(size / crop_pct))),
            A.CenterCrop(height=size, width=size),
            A.Normalize(mean=mean, std=std),
            ToTensorV2(),
        ]
    )
    return train, evaluate


class TextileDataset(Dataset):
    def __init__(
        self,
        rows: list[Record],
        data_root: Path,
        labels: dict[str, int],
        transform: A.Compose,
        decode_size: int,
    ):
        self.paths = [str(data_root / r.path) for r in rows]
        self.targets = [labels[r.label] for r in rows]
        self.transform = transform
        self.decode_size = decode_size

    def __len__(self) -> int:
        return len(self.paths)

    def __getitem__(self, i: int):
        with Image.open(self.paths[i]) as im:
            # JPEG draft decodes at 1/2..1/8 scale when the file is far larger than we
            # need; the result is never smaller than decode_size on either side.
            im.draft("RGB", (self.decode_size, self.decode_size))
            arr = np.asarray(im.convert("RGB"))
        return self.transform(image=arr)["image"], self.targets[i]


def _seed_worker(_: int) -> None:
    seed = torch.initial_seed() % 2**32
    np.random.seed(seed)
    random.seed(seed)
    info = torch.utils.data.get_worker_info()
    tf = getattr(info.dataset, "transform", None)
    if hasattr(tf, "set_random_seed"):  # albumentations >= 2 keeps its own RNG
        tf.set_random_seed(seed)


def load_rows(args: argparse.Namespace) -> dict[str, list[Record]]:
    rows = read_csv(args.split_csv)
    missing = [r for r in rows if not (args.data_root / r.path).exists()]
    if missing:
        by_split = Counter(r.split for r in missing)
        print(
            f"WARNING: {len(missing)} split rows missing on disk, dropped: {dict(by_split)}. "
            "Test-set size now differs from the frozen split; results.md records it."
        )
        gone = {r.path for r in missing}
        rows = [r for r in rows if r.path not in gone]
    out = {s: [r for r in rows if r.split == s] for s in ("train", "val", "test")}
    if args.limit_per_class:  # smoke tests / quick local runs only
        for split, rs in out.items():
            kept, per_label = [], Counter()
            for r in rs:
                per_label[r.label] += 1
                if per_label[r.label] <= args.limit_per_class:
                    kept.append(r)
            out[split] = kept
    return out


# --------------------------------------------------------------------------- model


def create_model(args: argparse.Namespace, n_classes: int) -> torch.nn.Module:
    kwargs = dict(
        pretrained=not args.no_pretrained, num_classes=n_classes, drop_path_rate=args.drop_path
    )
    if any(args.timm_name.startswith(p) for p in ("vit_", "eva", "deit", "beit")):
        kwargs["img_size"] = args.img_size  # e.g. DINOv2 ships at 518; resample pos-embed
    return timm.create_model(args.timm_name, **kwargs)


def param_groups(model: torch.nn.Module, args: argparse.Namespace) -> list[dict]:
    """AdamW groups: no WD on norms/biases, layer-wise lr decay, head at head_lr_mult x."""
    try:
        from timm.optim._param_groups import param_groups_layer_decay, param_groups_weight_decay
    except ImportError:  # timm < 1.0
        from timm.optim.optim_factory import param_groups_layer_decay, param_groups_weight_decay

    no_wd = getattr(model, "no_weight_decay", lambda: set())()
    if args.layer_decay and args.layer_decay < 1.0:
        groups = param_groups_layer_decay(
            model,
            weight_decay=args.weight_decay,
            no_weight_decay_list=no_wd,
            layer_decay=args.layer_decay,
        )
    else:
        groups = param_groups_weight_decay(
            model, weight_decay=args.weight_decay, no_weight_decay_list=no_wd
        )

    head_ids = {id(p) for p in model.get_classifier().parameters()}
    out = []
    for g in groups:
        scale = g.get("lr_scale", 1.0)
        body = [p for p in g["params"] if id(p) not in head_ids]
        head = [p for p in g["params"] if id(p) in head_ids]
        if body:
            out.append({**g, "params": body, "lr_scale": scale})
        if head:
            out.append({**g, "params": head, "lr_scale": scale * args.head_lr_mult})
    return out


def lr_at(step: int, total: int, warmup: int, base: float, final: float = 1e-7) -> float:
    """Linear warmup, then cosine to ~0 exactly at the last step."""
    if step < warmup:
        return base * (step + 1) / warmup
    progress = (step - warmup) / max(1, total - warmup)
    return final + 0.5 * (base - final) * (1 + math.cos(math.pi * min(1.0, progress)))


def make_ema(model: torch.nn.Module, decay: float):
    """(ema, update(model, step)). V3 warms the decay up, so short runs get a sane EMA too."""
    try:
        from timm.utils import ModelEmaV3

        ema = ModelEmaV3(model, decay=decay, use_warmup=True)
        return ema, lambda m, step: ema.update(m, step=step)
    except ImportError:  # older timm
        from timm.utils import ModelEmaV2

        ema = ModelEmaV2(model, decay=decay)
        return ema, lambda m, step: ema.update(m)


def soft_cross_entropy(logits, target, class_weights=None):
    """CE against soft (mixup/smoothed) targets, optionally class-weighted."""
    logp = F.log_softmax(logits.float(), dim=-1)
    if class_weights is None:
        return -(target * logp).sum(-1).mean()
    per_sample = -(target * class_weights * logp).sum(-1)
    return per_sample.sum() / (target @ class_weights).sum()


def class_balance_weights(targets: list[int], n_classes: int, power: float) -> np.ndarray:
    """Per-class weight count^-power, normalised so the average *sample* weight is 1."""
    counts = np.bincount(targets, minlength=n_classes).astype(float)
    w = np.where(counts > 0, np.maximum(counts, 1) ** -power, 0.0)
    return w * len(targets) / (w * counts).sum()


# ----------------------------------------------------------------------------- eval


@torch.no_grad()
def predict(model, loader, device, amp_ctx, tta: bool, channels_last: bool) -> tuple:
    """Logits (or log mean-probs under TTA) for a loader, on CPU."""
    model.eval()
    outs, ys = [], []
    for x, y in loader:
        x = x.to(device, non_blocking=True)
        if channels_last:
            x = x.contiguous(memory_format=torch.channels_last)
        with amp_ctx():
            if tta:  # hflip + rot90s: textures have no canonical orientation
                views = (x, x.flip(3), x.rot90(1, (2, 3)), x.rot90(3, (2, 3)))
                probs = torch.stack([model(v).float().softmax(-1) for v in views]).mean(0)
                out = probs.clamp_min(1e-12).log()
            else:
                out = model(x).float()
        outs.append(out.cpu())
        ys.append(y)
    return torch.cat(outs).numpy(), torch.cat(ys).numpy()


# ---------------------------------------------------------------------------- train


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    run_dir = args.out / args.partition / args.tag / f"seed{args.seed}"
    run_dir.mkdir(parents=True, exist_ok=True)
    seed_everything(args.seed)
    device = pick_device(args.device)
    amp_dtype, scaler = pick_amp(args.amp, device)
    amp_ctx = (lambda: torch.autocast(device.type, dtype=amp_dtype)) if amp_dtype else nullcontext
    channels_last = device.type == "cuda" and "convnext" in args.timm_name

    labels = class_index(args.partition)
    classes = sorted(labels, key=labels.get)
    rows = load_rows(args)
    print({s: len(r) for s, r in rows.items()})

    model = create_model(args, len(classes))
    data_cfg = timm.data.resolve_model_data_config(model)
    train_tf, eval_tf = build_transforms(
        args.img_size, data_cfg["mean"], data_cfg["std"], args.crop_pct
    )
    ds = {
        "train": TextileDataset(
            rows["train"], args.data_root, labels, train_tf, decode_size=2 * args.img_size
        ),
        **{
            s: TextileDataset(
                rows[s],
                args.data_root,
                labels,
                eval_tf,
                decode_size=math.ceil(args.img_size / args.crop_pct),
            )
            for s in ("val", "test")
        },
    }
    counts = np.bincount(ds["train"].targets, minlength=len(classes))
    print("train class counts:", dict(zip(classes, counts.tolist(), strict=True)))

    if hasattr(train_tf, "set_random_seed"):  # covers --workers 0; workers reseed themselves
        train_tf.set_random_seed(args.seed)
    gen = torch.Generator().manual_seed(args.seed)
    common = dict(
        num_workers=args.workers, pin_memory=device.type == "cuda", worker_init_fn=_seed_worker
    )
    keep = dict(persistent_workers=args.workers > 0)  # train/val iterate every epoch
    if args.sampler != "none":
        power = {"sqrt": 0.5, "inverse": 1.0}[args.sampler]
        w_cls = class_balance_weights(ds["train"].targets, len(classes), power)
        sampler = WeightedRandomSampler(
            w_cls[ds["train"].targets], len(ds["train"]), replacement=True, generator=gen
        )
        train_loader = DataLoader(
            ds["train"], args.batch_size, sampler=sampler, drop_last=True, **common, **keep
        )
    else:
        train_loader = DataLoader(
            ds["train"],
            args.batch_size,
            shuffle=True,
            generator=gen,
            drop_last=True,
            **common,
            **keep,
        )
    eval_bs = args.eval_batch_size or 2 * args.batch_size
    eval_loaders = {
        "val": DataLoader(ds["val"], eval_bs, **common, **keep),
        "test": DataLoader(ds["test"], eval_bs, **common),
    }

    model.to(device)
    if channels_last:
        model.to(memory_format=torch.channels_last)
    lr = args.lr * args.batch_size / 64  # linear scaling from the per-64 base lr
    groups = param_groups(model, args)
    optimizer = torch.optim.AdamW(groups, lr=lr, betas=(0.9, 0.999))
    ema, ema_update = make_ema(model, args.ema_decay)
    fwd = torch.compile(model) if args.compile else model

    mixup = None
    if args.mixup > 0 or args.cutmix > 0:
        mixup = timm.data.Mixup(
            mixup_alpha=args.mixup,
            cutmix_alpha=args.cutmix,
            switch_prob=args.mix_switch_prob,
            label_smoothing=args.smoothing,
            num_classes=len(classes),
        )
    class_w = None
    if args.class_weighted_loss != "none":
        power = {"sqrt": 0.5, "inverse": 1.0}[args.class_weighted_loss]
        class_w = torch.tensor(
            class_balance_weights(ds["train"].targets, len(classes), power),
            dtype=torch.float32,
            device=device,
        )

    steps_per_epoch = (
        len(train_loader)
        if not args.max_train_steps
        else min(len(train_loader), args.max_train_steps)
    )
    total_steps = steps_per_epoch * args.epochs
    warmup_steps = int(steps_per_epoch * args.warmup_epochs)

    start_epoch, best, stale = 0, {"val_top1": -1.0}, 0
    last_ckpt = run_dir / "last.pt"
    if args.resume and last_ckpt.exists():
        ck = torch.load(last_ckpt, map_location="cpu", weights_only=False)
        model.load_state_dict(ck["model"])
        ema.module.load_state_dict(ck["ema"])
        optimizer.load_state_dict(ck["optimizer"])
        if scaler and ck.get("scaler"):
            scaler.load_state_dict(ck["scaler"])
        start_epoch, best, stale = ck["epoch"] + 1, ck["best"], ck["stale"]
        torch.set_rng_state(ck["torch_rng"])
        gen.set_state(ck["gen_rng"])
        print(f"resumed at epoch {start_epoch}")

    write_config(
        run_dir,
        args,
        lr=lr,
        n=dict((s, len(d)) for s, d in ds.items()),
        data_cfg=data_cfg,
        train_counts=counts.tolist(),
        classes=classes,
    )

    head_ids = {id(p) for p in model.get_classifier().parameters()}
    for epoch in range(start_epoch, args.epochs):
        frozen = epoch < args.probe_epochs  # optional stage 1: head only
        if args.probe_epochs:
            for p in model.parameters():
                p.requires_grad_(not frozen or id(p) in head_ids)

        model.train()
        t0, seen, loss_sum = time.time(), 0, torch.zeros((), device=device)
        for i, (x, y) in enumerate(train_loader):
            if i >= steps_per_epoch:
                break
            step = epoch * steps_per_epoch + i
            cur = lr_at(step, total_steps, warmup_steps, lr)
            for g in optimizer.param_groups:
                g["lr"] = cur * g["lr_scale"]

            x, y = x.to(device, non_blocking=True), y.to(device, non_blocking=True)
            if channels_last:
                x = x.contiguous(memory_format=torch.channels_last)
            if mixup:
                x, target = mixup(x, y)
            else:
                target = F.one_hot(y, len(classes)).float()
                target = target * (1 - args.smoothing) + args.smoothing / len(classes)

            with amp_ctx():
                logits = fwd(x)
            loss = soft_cross_entropy(logits, target, class_w)

            optimizer.zero_grad(set_to_none=True)
            if scaler:
                scaler.scale(loss).backward()
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(model.parameters(), args.clip_grad)
                scaler.step(optimizer)
                scaler.update()
            else:
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), args.clip_grad)
                optimizer.step()
            ema_update(model, step)

            seen += x.shape[0]
            loss_sum += loss.detach() * x.shape[0]  # no per-step host sync
            if args.log_every and i % args.log_every == 0:
                if not torch.isfinite(loss):
                    raise FloatingPointError(f"non-finite loss at epoch {epoch} step {i}")
                print(
                    f"  ep {epoch} step {i}/{steps_per_epoch} loss {loss.item():.3f} "
                    f"lr {cur:.2e} {seen / (time.time() - t0):.0f} img/s",
                    flush=True,
                )
        train_time = time.time() - t0

        rec = {
            "epoch": epoch,
            "lr": cur,
            "train_loss": loss_sum.item() / max(seen, 1),
            "train_img_per_s": seen / train_time,
            "frozen_backbone": frozen,
        }
        for which, net in (("raw", model), ("ema", ema.module)):
            logits, ys = predict(net, eval_loaders["val"], device, amp_ctx, False, channels_last)
            s = summarize(logits, ys, classes)
            rec[f"val_{which}"] = {k: s[k] for k in ("top1", "top5", "macro_f1")}
        rec["epoch_s"] = time.time() - t0
        winner = max(("raw", "ema"), key=lambda w: rec[f"val_{w}"]["top1"])
        print(json.dumps(rec), flush=True)
        with open(run_dir / "log.jsonl", "a") as f:
            f.write(json.dumps(rec) + "\n")

        if rec[f"val_{winner}"]["top1"] > best["val_top1"]:
            best = {"val_top1": rec[f"val_{winner}"]["top1"], "epoch": epoch, "weights": winner}
            net = model if winner == "raw" else ema.module
            torch.save(
                {
                    "model": net.state_dict(),
                    "timm_name": args.timm_name,
                    "classes": classes,
                    "img_size": args.img_size,
                    "crop_pct": args.crop_pct,
                    "data_cfg": data_cfg,
                    "best": best,
                },
                run_dir / "best.pt",
            )
            stale = 0
        else:
            stale += 1
        torch.save(
            {
                "model": model.state_dict(),
                "ema": ema.module.state_dict(),
                "optimizer": optimizer.state_dict(),
                "scaler": scaler.state_dict() if scaler else None,
                "epoch": epoch,
                "best": best,
                "stale": stale,
                "torch_rng": torch.get_rng_state(),
                "gen_rng": gen.get_state(),
            },
            last_ckpt,
        )
        if args.patience and stale >= args.patience:
            print(f"early stop: no val improvement for {stale} epochs")
            break

    # ---- final: select TTA on val, then touch test exactly once --------------------
    ck = torch.load(run_dir / "best.pt", map_location="cpu", weights_only=False)
    model.load_state_dict(ck["model"])
    val_plain = summarize(
        *predict(model, eval_loaders["val"], device, amp_ctx, False, channels_last), classes
    )
    val_tta = summarize(
        *predict(model, eval_loaders["val"], device, amp_ctx, True, channels_last), classes
    )
    use_tta = val_tta["top1"] > val_plain["top1"]
    test = summarize(
        *predict(model, eval_loaders["test"], device, amp_ctx, use_tta, channels_last), classes
    )
    result = {
        "partition": args.partition,
        "tag": args.tag,
        "timm_name": args.timm_name,
        "seed": args.seed,
        "best": ck["best"],
        "tta": use_tta,
        "val": {"plain": _headline(val_plain), "tta": _headline(val_tta)},
        "test": test,
    }
    (run_dir / "test_metrics.json").write_text(json.dumps(result, indent=1))
    plot_confusion(test, classes, run_dir / "confusion.png")
    if not args.keep_last:
        last_ckpt.unlink(missing_ok=True)
    print(
        f"TEST {args.partition}/{args.tag}/seed{args.seed}: top1 {test['top1']:.4f} "
        f"top5 {test['top5']:.4f} macroF1 {test['macro_f1']:.4f} "
        f"(weights={ck['best']['weights']}, tta={use_tta})"
    )
    return 0


def _headline(s: dict) -> dict:
    return {k: s[k] for k in ("top1", "top5", "macro_f1")}


# --------------------------------------------------------------------------- plumbing


def seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.backends.cudnn.benchmark = True  # seeded, not bitwise-deterministic


def pick_device(name: str) -> torch.device:
    if name != "auto":
        return torch.device(name)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def pick_amp(name: str, device: torch.device):
    """bf16 where supported (no scaler needed), fp16 + GradScaler otherwise."""
    if name == "auto":
        if device.type != "cuda":
            return None, None
        name = "bf16" if torch.cuda.is_bf16_supported() else "fp16"
    if name == "none":
        return None, None
    if name == "bf16":
        return torch.bfloat16, None
    return torch.float16, torch.amp.GradScaler(device.type)


def write_config(run_dir: Path, args: argparse.Namespace, **extra) -> None:
    try:
        sha = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
        dirty = bool(subprocess.check_output(["git", "status", "--porcelain"], text=True).strip())
    except Exception:  # noqa: BLE001
        sha, dirty = None, None
    cfg = {
        "args": {k: str(v) if isinstance(v, Path) else v for k, v in vars(args).items()},
        "versions": {
            "python": platform.python_version(),
            "torch": torch.__version__,
            "timm": timm.__version__,
            "albumentations": A.__version__,
            "numpy": np.__version__,
            "cuda": torch.version.cuda,
        },
        "git": {"sha": sha, "dirty": dirty},
        "host": platform.node(),
        "gpu": torch.cuda.get_device_name() if torch.cuda.is_available() else None,
        **{k: v for k, v in extra.items() if k != "data_cfg"},
        "data_cfg": {
            k: list(v) if isinstance(v, tuple) else v for k, v in extra.get("data_cfg", {}).items()
        },
    }
    (run_dir / "config.json").write_text(json.dumps(cfg, indent=1))


def plot_confusion(summary: dict, classes: list[str], path: Path) -> None:
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return
    cm = np.array(summary["confusion_matrix"], dtype=float)
    cm = cm / np.maximum(cm.sum(1, keepdims=True), 1)
    n = len(classes)
    fig, ax = plt.subplots(figsize=(0.32 * n + 3, 0.32 * n + 2.5))
    ax.imshow(cm, cmap="Blues", vmin=0, vmax=1)
    ax.set_xticks(range(n), classes, rotation=90, fontsize=7)
    ax.set_yticks(range(n), classes, fontsize=7)
    ax.set_xlabel("predicted")
    ax.set_ylabel("true")
    ax.set_title(f"row-normalised confusion, top-1 {summary['top1']:.3f}")
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--partition", choices=["fabric", "fibre"], required=True)
    ap.add_argument(
        "--model",
        default="convnextv2_base",
        help=f"preset ({', '.join(PRESETS)}) or any timm model name",
    )
    ap.add_argument("--tag", help="run name (default: the preset / model name)")
    ap.add_argument("--data-root", type=Path, default=Path("data"))
    ap.add_argument("--split-csv", type=Path, help="default: <data-root>/splits/<partition>.csv")
    ap.add_argument("--out", type=Path, default=Path("runs"))
    ap.add_argument("--seed", type=int, default=0)

    g = ap.add_argument_group("model")
    g.add_argument("--img-size", type=int)
    g.add_argument("--crop-pct", type=float, default=0.875)
    g.add_argument("--drop-path", type=float)
    g.add_argument("--no-pretrained", action="store_true", help="debug only")
    g.add_argument("--compile", action="store_true")

    g = ap.add_argument_group("optimisation")
    g.add_argument("--epochs", type=int, default=30)
    g.add_argument("--batch-size", type=int, default=64)
    g.add_argument("--eval-batch-size", type=int, default=0)
    g.add_argument("--lr", type=float, default=1e-4, help="base lr per 64 images")
    g.add_argument("--head-lr-mult", type=float, default=10.0)
    g.add_argument("--layer-decay", type=float, help="default from preset; 1.0 disables")
    g.add_argument("--weight-decay", type=float, default=0.05)
    g.add_argument("--warmup-epochs", type=float, default=3)
    g.add_argument("--clip-grad", type=float, default=1.0)
    g.add_argument("--amp", choices=["auto", "bf16", "fp16", "none"], default="auto")
    g.add_argument(
        "--probe-epochs",
        type=int,
        default=0,
        help="two-stage: train only the head for this many epochs first",
    )
    g.add_argument("--patience", type=int, default=8, help="early stop on val top-1; 0 = off")

    g = ap.add_argument_group("regularisation / imbalance")
    g.add_argument("--smoothing", type=float, default=0.1)
    g.add_argument("--mixup", type=float, default=0.2)
    g.add_argument("--cutmix", type=float, default=1.0)
    g.add_argument("--mix-switch-prob", type=float, default=0.5)
    g.add_argument("--ema-decay", type=float, default=0.9998)
    g.add_argument("--sampler", choices=["none", "sqrt", "inverse"], default="none")
    g.add_argument("--class-weighted-loss", choices=["none", "sqrt", "inverse"], default="none")

    g = ap.add_argument_group("runtime")
    g.add_argument("--device", default="auto")
    g.add_argument("--workers", type=int, default=min(16, os.cpu_count() or 1))
    g.add_argument("--resume", action="store_true", help="continue from last.pt if present")
    g.add_argument("--keep-last", action="store_true", help="keep last.pt after finishing")
    g.add_argument("--log-every", type=int, default=200)
    g.add_argument("--limit-per-class", type=int, default=0, help="smoke tests only")
    g.add_argument("--max-train-steps", type=int, default=0, help="per epoch; smoke tests only")

    args = ap.parse_args(argv)
    preset = PRESETS.get(
        args.model, {"timm_name": args.model, "layer_decay": None, "drop_path": 0.1}
    )
    args.timm_name = preset["timm_name"]
    args.tag = args.tag or args.model
    args.img_size = args.img_size or preset.get("img_size", 224)
    args.drop_path = preset["drop_path"] if args.drop_path is None else args.drop_path
    args.layer_decay = preset["layer_decay"] if args.layer_decay is None else args.layer_decay
    args.split_csv = args.split_csv or args.data_root / "splits" / f"{args.partition}.csv"
    if args.batch_size % 2 and (args.mixup or args.cutmix):
        ap.error("mixup/cutmix need an even batch size")
    return args


if __name__ == "__main__":
    sys.exit(main())
