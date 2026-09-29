"""Fine-tune RT-DETRv2-R50 on Fashionpedia's garments. Spec §4.2, backend B.

Runs on the rented GPU (training/detector/run_cloud.sh). The checkpoint with the best
mAP on a fixed 5% hold-out of train is kept; Fashionpedia val is the test set, scored
once at the end with that checkpoint (spec §8.2: "Fashionpedia val mAP").

    python -m training.detector.train_rtdetr --data data/fashionpedia --out runs/rtdetr

Expects <data>/annotations/instances_attributes_{train,val}2020.json and the photos
anywhere under <data>/images/. Resumable: rerun the same command after an interruption.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
import time
from pathlib import Path

from training.detector.fashionpedia import CLASSES, Example, holdout, load, to_coco

MODEL_ID = "PekingU/rtdetr_v2_r50vd"
SCORE_FLOOR = 0.01  # keep low-score boxes for mAP; the served detector applies τ_det


def hflip(boxes, width: float) -> tuple:
    """COCO (x, y, w, h) boxes of a photo mirrored left-right."""
    return tuple((width - x - w, y, w, h) for x, y, w, h in boxes)


def coco_target(e: Example, boxes) -> dict:
    """One photo's annotations as RTDetrImageProcessor reads them (COCO detection)."""
    return {
        "image_id": e.image_id,
        "annotations": [
            {"bbox": list(b), "category_id": label, "area": b[2] * b[3], "iscrowd": 0}
            for b, label in zip(boxes, e.labels, strict=True)
        ],
    }


def coco_detections(image_id: int, scores, labels, boxes) -> list[dict]:
    """One photo's post-processed boxes (x0, y0, x1, y1) as COCO results (x, y, w, h)."""
    return [
        {
            "image_id": image_id,
            "category_id": int(label),
            "bbox": [x0, y0, x1 - x0, y1 - y0],
            "score": float(score),
        }  # fmt: skip
        for score, label, (x0, y0, x1, y1) in zip(scores, labels, boxes, strict=True)
    ]


def coco_map(examples: list[Example], detections: list[dict]) -> dict:
    """COCO mAP@[.5:.95] and AP50 with pycocotools (a training-only dependency)."""
    from pycocotools.coco import COCO
    from pycocotools.cocoeval import COCOeval

    if not detections:
        return {"map": 0.0, "ap50": 0.0}
    gt = COCO()
    gt.dataset = to_coco(examples)
    gt.createIndex()
    ev = COCOeval(gt, gt.loadRes(detections), "bbox")
    ev.evaluate()
    ev.accumulate()
    ev.summarize()
    return {"map": max(0.0, float(ev.stats[0])), "ap50": max(0.0, float(ev.stats[1]))}


def find_images(root: Path) -> dict[str, Path]:
    """file_name -> path, wherever the archives unpacked them."""
    return {p.name: p for p in Path(root).rglob("*") if p.suffix.lower() in (".jpg", ".jpeg")}


class Frames:
    """Map-style dataset: one photo and its target, as the processor encodes them. Defined
    at module level so DataLoader workers can receive it pickled."""

    def __init__(self, examples: list[Example], images: dict[str, Path], processor, flip: bool):
        self.examples, self.images, self.processor, self.flip = examples, images, processor, flip

    def __len__(self) -> int:
        return len(self.examples)

    def __getitem__(self, i: int) -> dict:
        from PIL import Image

        e = self.examples[i]
        img = Image.open(self.images[e.file_name]).convert("RGB")
        boxes = e.boxes
        if self.flip and random.random() < 0.5:
            img, boxes = img.transpose(Image.FLIP_LEFT_RIGHT), hflip(boxes, img.width)
        enc = self.processor(images=img, annotations=coco_target(e, boxes), return_tensors="pt")
        return {"pixel_values": enc["pixel_values"][0], "labels": enc["labels"][0]}


def collate(batch: list[dict]) -> dict:
    import torch

    return {"pixel_values": torch.stack([b["pixel_values"] for b in batch]),
            "labels": [b["labels"] for b in batch]}  # fmt: skip


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    import torch
    from PIL import Image
    from torch.utils.data import DataLoader
    from transformers import RTDetrImageProcessor, RTDetrV2ForObjectDetection

    random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = torch.device(args.device if args.device != "auto" else
                          ("cuda" if torch.cuda.is_available() else "cpu"))  # fmt: skip
    torch.backends.cuda.matmul.allow_tf32 = True
    ann = args.data / "annotations"
    train, held = holdout(load(ann / "instances_attributes_train2020.json"), args.holdout_frac)
    test = load(ann / "instances_attributes_val2020.json")
    if args.limit:  # smoke runs
        train, held, test = train[: args.limit], held[: args.limit], test[: args.limit]
    images = find_images(args.data / "images")
    print(f"train {len(train)}, hold-out {len(held)}, test (val) {len(test)} photos", flush=True)

    processor = RTDetrImageProcessor.from_pretrained(args.model)

    def predict(model, examples: list[Example]) -> list[dict]:
        model.eval()
        dets: list[dict] = []
        for i in range(0, len(examples), args.batch_size):
            chunk = examples[i : i + args.batch_size]
            pil = [Image.open(images[e.file_name]).convert("RGB") for e in chunk]
            inputs = processor(images=pil, return_tensors="pt")
            with torch.no_grad():
                out = model(pixel_values=inputs["pixel_values"].to(device))
            sizes = [(im.height, im.width) for im in pil]
            results = processor.post_process_object_detection(
                out, threshold=SCORE_FLOOR, target_sizes=sizes
            )
            for e, r in zip(chunk, results, strict=True):
                dets += coco_detections(
                    e.image_id, r["scores"].tolist(), r["labels"].tolist(), r["boxes"].tolist()
                )
        return dets

    model = RTDetrV2ForObjectDetection.from_pretrained(
        args.model,
        id2label=dict(enumerate(CLASSES)),
        label2id={c: i for i, c in enumerate(CLASSES)},
        ignore_mismatched_sizes=True,  # a new 14-class head on the COCO-trained model
    ).to(device)
    loader = DataLoader(
        Frames(train, images, processor, flip=True),
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=args.workers,
        collate_fn=collate,
        drop_last=len(train) > args.batch_size,
    )
    backbone = [p for n, p in model.named_parameters() if "backbone" in n]
    rest = [p for n, p in model.named_parameters() if "backbone" not in n]
    opt = torch.optim.AdamW(
        [{"params": backbone, "lr": args.lr * args.backbone_lr_mult}, {"params": rest}],
        lr=args.lr, weight_decay=args.weight_decay,
    )  # fmt: skip
    total = max(1, args.epochs * len(loader))
    warmup = min(args.warmup_steps, total // 10)

    def lr_at(step: int) -> float:
        if step < warmup:
            return (step + 1) / warmup
        return 0.5 * (1 + math.cos(math.pi * (step - warmup) / max(1, total - warmup)))

    sched = torch.optim.lr_scheduler.LambdaLR(opt, lr_at)

    args.out.mkdir(parents=True, exist_ok=True)
    last = args.out / "last.pt"
    start, best, history = 0, -1.0, []
    if last.exists():
        state = torch.load(last, map_location=device, weights_only=False)
        model.load_state_dict(state["model"])
        opt.load_state_dict(state["opt"])
        sched.load_state_dict(state["sched"])
        start, best, history = state["epoch"] + 1, state["best"], state["history"]
        print(f"resuming after epoch {start}", flush=True)

    for epoch in range(start, args.epochs):
        model.train()
        t0, losses = time.time(), []
        for batch in loader:
            labels = [{k: v.to(device) for k, v in t.items()} for t in batch["labels"]]
            loss = model(pixel_values=batch["pixel_values"].to(device), labels=labels).loss
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), args.clip)
            opt.step()
            sched.step()
            losses.append(loss.item())
        score = coco_map(held, predict(model, held))
        history.append({"epoch": epoch, "loss": sum(losses) / max(1, len(losses)), **score,
                        "minutes": (time.time() - t0) / 60})  # fmt: skip
        print(json.dumps(history[-1]), flush=True)
        if score["map"] > best:
            best = score["map"]
            model.save_pretrained(args.out / "best")
            processor.save_pretrained(args.out / "best")
        torch.save({"model": model.state_dict(), "opt": opt.state_dict(),
                    "sched": sched.state_dict(), "epoch": epoch, "best": best,
                    "history": history}, last)  # fmt: skip

    chosen = RTDetrV2ForObjectDetection.from_pretrained(args.out / "best").to(device)
    metrics = {
        "model": args.model,
        "domain": "catalog (Fashionpedia)",
        "n": {"train": len(train), "holdout": len(held), "test_val2020": len(test)},
        "holdout_best_map": best,
        "test_val2020": coco_map(test, predict(chosen, test)),
        "history": history,
    }
    (args.out / "metrics.json").write_text(json.dumps(metrics, indent=1))
    print(f"wrote {args.out / 'metrics.json'}: test mAP {metrics['test_val2020']['map']:.3f}")
    return 0


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--data", type=Path, default=Path("data/fashionpedia"))
    ap.add_argument("--out", type=Path, default=Path("runs/rtdetr"))
    ap.add_argument("--model", default=MODEL_ID)
    ap.add_argument("--epochs", type=int, default=12)
    ap.add_argument("--batch-size", type=int, default=16)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--backbone-lr-mult", type=float, default=0.1)
    ap.add_argument("--weight-decay", type=float, default=1e-4)
    ap.add_argument("--warmup-steps", type=int, default=500)
    ap.add_argument("--clip", type=float, default=0.1)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--holdout-frac", type=float, default=0.05)
    ap.add_argument("--limit", type=int, default=0, help="first N photos per split (smoke runs)")
    ap.add_argument("--device", default="auto")
    ap.add_argument("--seed", type=int, default=0)
    return ap.parse_args(argv)


if __name__ == "__main__":
    sys.exit(main())
