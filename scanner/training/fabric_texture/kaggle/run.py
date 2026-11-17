"""Look-alike fabric ID from patch texture (fault plan Task 11), on the shop photos.

Same rows, labels and product-level split as the served local_fabric head. Variants, chosen on
val and scored on test once: the v8 pooled features (baseline, cached by
texpilot-shop-heads-v8-bias), DINOv2-reg ViT-B/14 patch tokens pooled over five native-scale
crops, both together, and both plus nearest-patch memory distances (the fault detector's
patch-memory idea used as a classifier). Self-contained: crops, pool_tokens and the memory
follow training/fabric_texture/{features,heads}.py.
"""

import csv
import glob
import hashlib
import json
import os
import subprocess
from collections import Counter

import numpy as np
import timm
import torch
from PIL import Image, ImageFile
from torch.utils.data import DataLoader, Dataset

ImageFile.LOAD_TRUNCATED_IMAGES = True
SIZE, TOKENS_KEPT, PER_CLASS, SEED = 392, 32, 5000, 2026
MIN_PRODUCTS = 150
V8_TEST_MACRO_F1 = 0.6250  # served local_fabric head; the baseline here must land within 0.01
OUT = "/kaggle/working"
dev = torch.device("cuda")


def md5(s):
    return int(hashlib.md5(s.encode()).hexdigest(), 16)


def crops(img, size=SIZE):
    h, w = img.shape[:2]
    if min(h, w) < size:
        s = size / min(h, w)
        img = np.asarray(Image.fromarray(img).resize((round(w * s), round(h * s)), Image.BILINEAR))
        h, w = img.shape[:2]
    corners = [
        ((h - size) // 2, (w - size) // 2),
        (0, 0),
        (0, w - size),
        (h - size, 0),
        (h - size, w - size),
    ]
    return np.stack([img[y : y + size, x : x + size] for y, x in corners])


def pool_tokens(t):
    gem = t.clamp(min=1e-6).pow(3.0).mean(dim=-2).pow(1.0 / 3.0)
    return torch.cat([t.mean(dim=-2), t.amax(dim=-2), gem], dim=-1)


# ---- rows, in the cached-feature order -------------------------------------------------------
shops = sorted(glob.glob("/kaggle/input/**/shops/all_manifest.csv", recursive=True))[0].rsplit(
    "/", 1
)[0]
os.makedirs("/tmp/shops", exist_ok=True)
for t in sorted(glob.glob(f"{shops}/*.tar")):
    subprocess.run(["tar", "-xf", t, "-C", "/tmp/shops"], check=True)
with open(f"{shops}/all_manifest.csv") as f:
    by_path = {r["path"]: r for r in csv.DictReader(f)}
with open(sorted(glob.glob("/kaggle/input/**/feats_v8_paths.json", recursive=True))[0]) as f:
    paths = json.load(f)
X8 = np.load(sorted(glob.glob("/kaggle/input/**/feats_v8.npy", recursive=True))[0]).astype(
    np.float32
)
assert len(paths) == len(X8) and all(
    p in by_path and os.path.exists("/tmp/shops/" + p) for p in paths
)
rows = [by_path[p] for p in paths]
N = len(rows)
print(N, "photos", flush=True)

split = np.array(
    [
        (lambda h: "train" if h < 70 else "val" if h < 85 else "test")(
            md5(r["store"] + r["product_id"]) % 100
        )
        for r in rows
    ]
)
half = np.array([md5(r["product_id"] + r["store"]) % 2 for r in rows])
lab = np.array([r["fabric"] for r in rows])
products = Counter(
    (r["fabric"], r["store"], r["product_id"])
    for r, s in zip(rows, split, strict=True)
    if r["fabric"] and s == "train"
)
per_class = Counter(c for c, _, _ in products)
classes = sorted(c for c, n in per_class.items() if n >= MIN_PRODUCTS)
K = len(classes)
y = np.array([classes.index(c) if c in classes else -1 for c in lab])
idx = y >= 0
tr, va, te = (idx & (split == s) for s in ("train", "val", "test"))
print(
    K, "classes", classes, "train/val/test", int(tr.sum()), int(va.sum()), int(te.sum()), flush=True
)

# ---- DINOv2 patch tokens ---------------------------------------------------------------------
model = timm.create_model(
    "vit_base_patch14_reg4_dinov2.lvd142m", pretrained=True, num_classes=0, img_size=SIZE
)
model = model.eval().half().to(dev)
skip = model.num_prefix_tokens
mean = torch.tensor([0.485, 0.456, 0.406], device=dev).view(1, 3, 1, 1)
std = torch.tensor([0.229, 0.224, 0.225], device=dev).view(1, 3, 1, 1)


class DS(Dataset):
    def __len__(self):
        return N

    def __getitem__(self, i):
        img = np.asarray(Image.open("/tmp/shops/" + rows[i]["path"]).convert("RGB"))
        return torch.from_numpy(crops(img))  # (5, S, S, 3) uint8


XD = np.zeros((N, 3 * 768), np.float32)
TOK = np.lib.format.open_memmap("/tmp/tok.npy", "w+", np.float16, (N, TOKENS_KEPT, 768))
g = torch.Generator(device="cpu").manual_seed(SEED)
at = 0
with torch.no_grad():
    for b in DataLoader(DS(), batch_size=16, num_workers=4):
        n = len(b)
        x = b.view(n * 5, SIZE, SIZE, 3).to(dev).permute(0, 3, 1, 2).half().div_(255)
        t = model.forward_features((x - mean.half()) / std.half())[
            :, skip:
        ].float()  # (n*5, P, 768)
        XD[at : at + n] = pool_tokens(t).view(n, 5, -1).mean(1).cpu().numpy()
        centre = t.view(n, 5, t.shape[1], 768)[:, 0]
        pick = torch.randperm(t.shape[1], generator=g)[:TOKENS_KEPT]
        TOK[at : at + n] = centre[:, pick].half().cpu().numpy()
        at += n
        if at % 8000 < 16:
            print("features", at, "/", N, flush=True)
assert at == N
np.save(f"{OUT}/feats_dinov2_patch.npy", XD.astype(np.float16))
del model
torch.cuda.empty_cache()

# ---- nearest-patch memory: bank from train half 0; its head trains on train half 1 ----
rng = np.random.default_rng(SEED)
bank = []
for c in range(K):
    ids = np.flatnonzero(tr & (y == c) & (half == 0))
    t = np.asarray(TOK[np.sort(ids)], np.float32).reshape(-1, 768)
    t = t[rng.choice(len(t), PER_CLASS, replace=len(t) < PER_CLASS)]
    bank.append(torch.nn.functional.normalize(torch.from_numpy(t), dim=1))
bank = torch.stack(bank).to(dev).half()  # (K, PER_CLASS, 768)
XM = np.zeros((N, K), np.float32)
with torch.no_grad():
    for s in range(0, N, 128):
        q = torch.from_numpy(np.asarray(TOK[s : s + 128], np.float32)).to(dev)
        q = torch.nn.functional.normalize(q, dim=2).half()  # (n, T, 768)
        sim = torch.einsum("ntd,kpd->ntkp", q, bank).amax(3)  # (n, T, K)
        XM[s : s + 128] = (1 - sim.float()).mean(1).cpu().numpy()
print("memory distances done", flush=True)


# ---- heads -------------------------------------------------------------------------------------
def macro_f1(logits, yy):
    pred = logits.argmax(1)
    f = []
    for c in np.unique(yy):
        tp = np.sum((pred == c) & (yy == c))
        p, r = tp / max(np.sum(pred == c), 1), tp / max(np.sum(yy == c), 1)
        f.append(0.0 if tp == 0 else 2 * p * r / (p + r))
    return float(np.mean(f))


def tune_class_bias(logits, yy, passes=3):
    bias, grid, best = np.zeros(K), np.arange(-2.0, 2.01, 0.25), macro_f1(logits, yy)
    for _ in range(passes):
        improved = False
        for c in range(K):
            for v in grid:
                trial = bias.copy()
                trial[c] = v
                f = macro_f1(logits + trial, yy)
                if f > best + 1e-6:
                    best, bias, improved = f, trial, True
        if not improved:
            break
    return bias - bias.mean()


def fit_lr(Z, yy, C):
    """Balanced multinomial logistic regression, sklearn's objective:
    C * sum(w_i * CE_i) + 0.5 * |W|^2."""
    Zt, yt = torch.from_numpy(Z).to(dev), torch.from_numpy(yy).to(dev)
    cw = torch.tensor(len(yy) / (K * np.bincount(yy, minlength=K)), dtype=torch.float32, device=dev)
    W = torch.zeros(K, Z.shape[1], device=dev, requires_grad=True)
    b = torch.zeros(K, device=dev, requires_grad=True)
    opt = torch.optim.LBFGS([W, b], max_iter=500, history_size=20, line_search_fn="strong_wolfe")

    def closure():
        opt.zero_grad()
        ce = torch.nn.functional.cross_entropy(Zt @ W.T + b, yt, weight=cw, reduction="none")
        loss = C * (ce * 1.0).sum() + 0.5 * (W * W).sum()
        loss.backward()
        return loss

    # cross_entropy(weight=..., reduction="none") already multiplies each row by its class weight.
    opt.step(closure)
    return W.detach().cpu().numpy(), b.detach().cpu().numpy()


def run(name, X, train_mask):
    mu, sd = X[train_mask].mean(0), X[train_mask].std(0) + 1e-6
    Z = ((X - mu) / sd).astype(np.float32)
    best = None
    for C in (0.003, 0.01, 0.03, 0.1, 0.3):
        W, b = fit_lr(Z[train_mask], y[train_mask], C)
        f = macro_f1(Z[va] @ W.T + b, y[va])
        print(name, "C", C, "val macro F1", round(f, 4), flush=True)
        if best is None or f > best[0]:
            best = (f, C, W, b)
    f_val, C, W, b = best
    lv, yv, hv = Z[va] @ W.T + b, y[va], half[va]
    gain = np.mean(
        [
            macro_f1(lv[hv != k] + tune_class_bias(lv[hv == k], yv[hv == k]), yv[hv != k])
            - macro_f1(lv[hv != k], yv[hv != k])
            for k in (0, 1)
        ]
    )
    bias = tune_class_bias(lv, yv) if gain > 0 else np.zeros(K)
    return {
        "name": name,
        "C": C,
        "n_train": int(train_mask.sum()),
        "dim": int(X.shape[1]),
        "val_macro_f1_no_bias": f_val,
        "bias_heldout_gain": float(gain),
        "val_macro_f1": macro_f1(lv + bias, yv),
        "val_top1": float(((lv + bias).argmax(1) == yv).mean()),
        "_test_logits": Z[te] @ W.T + b + bias,
        "_w": W / sd,
        "_b": b + bias - (W / sd) @ mu,
    }


def scored(r):
    lt, yt = r["_test_logits"], y[te]
    pred = lt.argmax(1)
    per = {}
    for c in range(K):
        tp = np.sum((pred == c) & (yt == c))
        p, rc = tp / max(np.sum(pred == c), 1), tp / max(np.sum(yt == c), 1)
        per[classes[c]] = 0.0 if tp == 0 else float(2 * p * rc / (p + rc))
    conf = np.zeros((K, K), int)
    np.add.at(conf, (yt, pred), 1)
    return {
        "test_macro_f1": macro_f1(lt, yt),
        "test_top1": float((pred == yt).mean()),
        "test_per_class_f1": per,
        "test_confusion_rows_true": conf.tolist(),
    }


XC = np.concatenate([X8, XD], 1)
tr1 = tr & (half == 1)
variants = [
    run("v8_baseline", X8, tr),
    run("dinov2_patch", XD, tr),
    run("v8+dinov2_patch", XC, tr),
    run("v8+dinov2_patch+memory", np.concatenate([XC, XM], 1), tr1),
    run("v8+dinov2_patch (same half as memory)", XC, tr1),
]
base = variants[0]
base.update(scored(base))
reproduced = abs(base["test_macro_f1"] - V8_TEST_MACRO_F1) <= 0.01
best = max(variants, key=lambda r: r["val_macro_f1"])
if best is not base:
    best.update(scored(best))  # the one test look for the val-chosen variant
te_rows = [rows[i] for i in np.flatnonzero(te)]
test_product = np.array([r["store"] + "|" + r["product_id"] for r in te_rows])
if best is not base:
    # keep rule: paired bootstrap over test products, 1000 resamples, seed 2026
    yt, bl, bs = y[te], base["_test_logits"], best["_test_logits"]
    by_product = {}
    for j, p in enumerate(test_product):
        by_product.setdefault(p, []).append(j)
    groups = [np.array(v) for v in by_product.values()]
    boot = np.random.default_rng(2026)
    diffs = []
    for _ in range(1000):
        pick = boot.choice(len(groups), size=len(groups), replace=True)
        idx = np.concatenate([groups[g] for g in pick])
        diffs.append(macro_f1(bs[idx], yt[idx]) - macro_f1(bl[idx], yt[idx]))
    diffs = np.array(diffs)
    lo, hi = np.percentile(diffs, [2.5, 97.5])
    paired_bootstrap = {
        "resamples": 1000,
        "seed": 2026,
        "unit": "product",
        "n_products": len(groups),
        "mean_diff": float(diffs.mean()),
        "ci95_low": float(lo),
        "ci95_high": float(hi),
        "keep": bool(lo > 0),
    }
else:
    paired_bootstrap = None
np.savez(
    f"{OUT}/test_predictions.npz",
    y=y[te],
    base=base["_test_logits"].astype(np.float32),
    best=best["_test_logits"].astype(np.float32),
    product=test_product,
)
if best is not base:
    np.savez(
        f"{OUT}/texture_head.npz",
        w=best["_w"].astype(np.float32),
        b=best["_b"].astype(np.float32),
        classes=np.array(classes),
        variant=best["name"],
    )
report = {
    "classes": classes,
    "n": {"train": int(tr.sum()), "val": int(va.sum()), "test": int(te.sum())},
    "served_v8_test_macro_f1": V8_TEST_MACRO_F1,
    "baseline_reproduced_within_0.01": bool(reproduced),
    "chosen_on_val": best["name"],
    "variants": [{k: v for k, v in r.items() if not k.startswith("_")} for r in variants],
    "paired_bootstrap": paired_bootstrap,
    "note": "test is scored for the baseline and the val-chosen variant only; "
    "memory variants train on half the train products",
}
print("BOOTSTRAP", json.dumps(report["paired_bootstrap"]), flush=True)
with open(f"{OUT}/texture_results.json", "w") as f:
    json.dump(report, f, indent=1)
print(
    json.dumps({k: report[k] for k in ("baseline_reproduced_within_0.01", "chosen_on_val")}),
    flush=True,
)
for r in report["variants"]:
    print(
        json.dumps(
            {
                k: r.get(k)
                for k in ("name", "C", "val_macro_f1", "val_top1", "test_macro_f1", "test_top1")
            }
        ),
        flush=True,
    )
