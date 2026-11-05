"""Simulated worker-correction retraining rounds on the frozen fabric24 head.

The deployed Head A is an MLP (Linear, GELU, Dropout, Linear) on pooled features of the
v8 SigLIP encoder. This module keeps that encoder fixed and retrains only the MLP, so a
round costs seconds on CPU and every strategy/noise/seed cell can run deterministically.

Per round r (r = 1..R) of one (strategy, noise, seed) cell:

1. the current head predicts on the unlabeled stream (train rows nobody has labeled yet);
2. the abstain threshold tau is fitted on validation only (Agent 1's calibration.py);
3. the strategy picks ``budget`` stream items to send to a worker;
4. a simulated worker answers with the archive label, flipped to another class with
   probability ``noise`` (nested across noise levels, so 10% flips a superset of 5%);
5. the corrections join the training set and the MLP is retrained from scratch.

Test rows are never used for selection, threshold fitting or training. Each round is
logged with validation and test macro F1 (macro F1 first), accuracy, abstain rate and
per-class F1; corrections are written in the manifest shape that the real ERP export
must also produce (see ``load_manifest``).

    python -m training.textilenet.retrain_rounds --features <feature cache dir> \
        --split-csv data/splits/prelim/fabric.csv --deployed-head models/scanner-v8/head_a \
        --out training/textilenet/results/retrain_rounds
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import sys
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

from training.scanner.calibration import abstain_threshold, fit_temperature
from training.textilenet.feature_cache import FeatureCache
from training.textilenet.metrics import summarize
from training.textilenet.splits import read_csv

STRATEGIES = ("none", "random", "abstain", "mixed")
STRATEGY_ID = {s: i for i, s in enumerate(STRATEGIES)}
MANIFEST_COLUMNS = ["path", "round", "model_label", "model_confidence", "human_label", "source"]
EXCLUDED_CLASSES = {"canvas", "plush"}  # fabric24: TextileNet classes without enough photos
RENAMED = {"jersey": "knit"}  # fabric24: jersey merged into knit (as in the deployed head)
INIT_STREAM, WORKER_STREAM = 0x1A17, 0x3E57  # fixed salts for the per-purpose RNG streams


# ---------------------------------------------------------------- labels and rows


def fabric24_label(label: str) -> str | None:
    """Archive label -> fabric24 label, or None when the class is out of scope."""
    if label in EXCLUDED_CLASSES:
        return None
    return RENAMED.get(label, label)


@dataclass
class Pool:
    paths: list[str]
    y: np.ndarray  # class index, archive label (the simulator's truth)
    split: np.ndarray  # "train" | "val" | "test"
    x: np.ndarray  # standardized features, float32 (train statistics)
    raw: np.ndarray  # the cached features as stored, for the deployed-probe parity check
    classes: list[str]
    exclusions: dict


def load_pool(split_csv: Path, features_dir: Path, classes: list[str]) -> Pool:
    """Archive fabric24 rows that have a cached feature. Every exclusion is counted."""
    excluded: Counter = Counter()
    kept = []
    for r in read_csv(split_csv):
        if r.source != "archive":
            excluded["not_archive"] += 1
            continue
        label = fabric24_label(r.label)
        if label is None:
            excluded[f"out_of_scope:{r.label}"] += 1
            continue
        if label not in classes:
            raise ValueError(f"{label!r} ({r.path}) is not in the head's class list")
        kept.append((r.path, classes.index(label), r.split))

    cache = FeatureCache(features_dir)
    have = set(cache.missing([p for p, _, _ in kept]))  # paths NOT cached
    rows = []
    for path, y, split in kept:
        if path in have:
            excluded[f"no_feature:{split}"] += 1
        else:
            rows.append((path, y, split))
    if not rows:
        raise SystemExit("no archive fabric24 rows with cached features")

    raw = cache.assemble([p for p, _, _ in rows]).astype(np.float32)
    split = np.array([s for _, _, s in rows])
    mu = raw[split == "train"].mean(0)
    sd = raw[split == "train"].std(0) + 1e-6  # fitted on train rows only
    return Pool(
        paths=[p for p, _, _ in rows],
        y=np.array([y for _, y, _ in rows]),
        split=split,
        x=((raw - mu) / sd).astype(np.float32),
        raw=raw,
        classes=list(classes),
        exclusions=dict(sorted(excluded.items())),
    )


# ---------------------------------------------------------------- simulator logic (pure)


def stratified_initial(
    y: np.ndarray, train_idx: np.ndarray, frac: float, min_per_class: int, seed: int
) -> np.ndarray:
    """A small, class-balanced starting subset of the train pool (the "older" labeled data)."""
    rng = np.random.default_rng([seed, INIT_STREAM])
    chosen = []
    for c in np.unique(y[train_idx]):
        members = train_idx[y[train_idx] == c]
        k = min(len(members), max(min_per_class, round(frac * len(members))))
        chosen.append(rng.choice(members, size=k, replace=False))
    return np.sort(np.concatenate(chosen))


def select_corrections(
    strategy: str,
    *,
    stream: np.ndarray,
    conf: np.ndarray,
    pred: np.ndarray,
    truth: np.ndarray,
    tau: float,
    budget: int,
    wrong_frac: float,
    rng: np.random.Generator,
) -> np.ndarray:
    """Pick the pool indices a worker will label this round.

    ``stream``: candidate indices (unlabeled train rows). ``conf``, ``pred``, ``truth`` are
    indexed by pool position. Only ``stream`` entries are read.

    - none:    nothing.
    - random:  uniform sample, the same budget.
    - abstain: lowest model confidence first; every abstained item (conf < tau) comes first.
    - mixed:   round((1 - wrong_frac) * budget) lowest-confidence items, plus
               round(wrong_frac * budget) confident mistakes sampled uniformly from the
               confident-wrong stream items. Those are chosen with the true label, an
               oracle spot-check, so this is an upper bound on what a reviewer could find.
    """
    if strategy not in STRATEGY_ID:
        raise ValueError(f"unknown strategy {strategy!r}")
    stream = np.asarray(stream)
    budget = min(budget, len(stream))
    if strategy == "none" or budget == 0:
        return np.empty(0, dtype=np.int64)
    if strategy == "random":
        return rng.choice(stream, size=budget, replace=False)

    by_conf = stream[np.argsort(conf[stream], kind="stable")]
    if strategy == "abstain":
        return by_conf[:budget]

    n_wrong = round(wrong_frac * budget)
    wrong_pool = stream[(conf[stream] >= tau) & (pred[stream] != truth[stream])]
    wrong = rng.choice(wrong_pool, size=min(n_wrong, len(wrong_pool)), replace=False)
    rest = by_conf[~np.isin(by_conf, wrong)][: budget - len(wrong)]
    return np.concatenate([wrong, rest]).astype(np.int64)


def worker_labels(
    truth: np.ndarray, noise: float, n_classes: int, rng: np.random.Generator
) -> np.ndarray:
    """Simulated worker answers: the truth, flipped to a uniformly random other class with
    probability ``noise``. Uniform draws are fixed by the rng, so the flip sets are nested."""
    u = rng.random(len(truth))
    other = (truth + rng.integers(1, n_classes, size=len(truth))) % n_classes
    return np.where(u < noise, other, truth).astype(np.int64)


def worker_rng(seed: int, strategy: str, rnd: int) -> np.random.Generator:
    return np.random.default_rng([seed, STRATEGY_ID[strategy], rnd, WORKER_STREAM])


def selection_rng(seed: int, strategy: str, rnd: int) -> np.random.Generator:
    return np.random.default_rng([seed, STRATEGY_ID[strategy], rnd])


# ---------------------------------------------------------------- manifest (shared shape)


def write_manifest(rows: list[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=MANIFEST_COLUMNS)
        w.writeheader()
        w.writerows(rows)


def load_manifest(
    path: Path, classes: list[str], known_paths: set[str] | None = None
) -> tuple[list[str], np.ndarray]:
    """Read a correction manifest and return (paths, human class index).

    Shape: path, round, model_label, model_confidence, human_label, source. The simulator
    and the real ERP export both write this. Malformed input fails rather than being
    skipped: a dropped correction changes the experiment silently.
    """
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        missing = set(MANIFEST_COLUMNS) - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"{path}: missing columns {sorted(missing)}")
        rows = list(reader)
    seen: set[str] = set()
    paths, human = [], []
    for i, r in enumerate(rows, start=2):
        p = r["path"].strip()
        if not p:
            raise ValueError(f"{path}:{i}: empty path")
        if p in seen:
            raise ValueError(f"{path}:{i}: duplicate correction for {p}")
        seen.add(p)
        if known_paths is not None and p not in known_paths:
            raise ValueError(f"{path}:{i}: {p} is not in the training pool")
        for col in ("model_label", "human_label"):
            if r[col] not in classes:
                raise ValueError(f"{path}:{i}: unknown {col} {r[col]!r}")
        conf = float(r["model_confidence"])
        if not 0.0 <= conf <= 1.0:
            raise ValueError(f"{path}:{i}: model_confidence {conf} outside [0, 1]")
        paths.append(p)
        human.append(classes.index(r["human_label"]))
    return paths, np.array(human, dtype=np.int64)


# ---------------------------------------------------------------- the MLP head


@dataclass(frozen=True)
class Recipe:
    hidden: int = 1024
    dropout: float = 0.2
    lr: float = 3e-3
    wd: float = 1e-4
    epochs: int = 30
    batch: int = 256
    label_smoothing: float = 0.1


def device():
    import torch

    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def train_mlp(x: np.ndarray, y: np.ndarray, n_classes: int, seed: int, recipe: Recipe):
    """Same architecture as the deployed probe. Warmup (10%) then cosine, AdamW.

    Runs on CUDA when present (Kaggle GPU), else CPU. Seeded either way.
    """
    import torch
    import torch.nn.functional as F

    dev = device()
    torch.manual_seed(seed)
    gen = torch.Generator().manual_seed(seed)
    model = torch.nn.Sequential(
        torch.nn.Linear(x.shape[1], recipe.hidden),
        torch.nn.GELU(),
        torch.nn.Dropout(recipe.dropout),
        torch.nn.Linear(recipe.hidden, n_classes),
    )
    model = model.to(dev)
    opt = torch.optim.AdamW(model.parameters(), lr=recipe.lr, weight_decay=recipe.wd)
    xt, yt = torch.from_numpy(x).to(dev), torch.from_numpy(y).long().to(dev)
    steps_per_epoch = math.ceil(len(xt) / recipe.batch)
    total = recipe.epochs * steps_per_epoch
    warm = max(1, total // 10)
    step = 0
    model.train()
    for _ in range(recipe.epochs):
        for idx in torch.randperm(len(xt), generator=gen).split(recipe.batch):
            if step < warm:
                scale = (step + 1) / warm
            else:
                progress = (step - warm) / max(1, total - warm)
                scale = 0.5 * (1 + math.cos(math.pi * progress))
            for group in opt.param_groups:
                group["lr"] = recipe.lr * scale
            loss = F.cross_entropy(model(xt[idx]), yt[idx], label_smoothing=recipe.label_smoothing)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
            step += 1
    return model.eval()


def logits_of(model, x: np.ndarray, batch: int = 8192) -> np.ndarray:
    import torch

    out = []
    with torch.no_grad():
        for i in range(0, len(x), batch):
            xb = torch.from_numpy(x[i : i + batch]).to(next(model.parameters()).device)
            out.append(model(xb).cpu().numpy())
    return np.concatenate(out) if out else np.zeros((0, 0), np.float32)


def softmax(logits: np.ndarray, t: float) -> np.ndarray:
    from services.vision.heads import softmax as _softmax

    return _softmax(logits, t)


def evaluate(logits_val, y_val, logits_test, y_test, classes, target: float) -> dict:
    """Threshold and temperature from validation only; test is reported, never fitted."""
    temperature = fit_temperature(logits_val, y_val)
    pv = softmax(logits_val, temperature)
    tau, _ = abstain_threshold(pv.max(1), pv.argmax(1) == y_val, target)
    pt = softmax(logits_test, temperature)
    val = summarize(logits_val, y_val, classes, n_pairs=0)
    test = summarize(logits_test, y_test, classes, n_pairs=0)
    return {
        "temperature": float(temperature),
        "tau": float(tau),
        "val_macro_f1": val["macro_f1"],
        "val_top1": val["top1"],
        "test_macro_f1": test["macro_f1"],
        "test_top1": test["top1"],
        "test_weighted_f1": test["weighted_f1"],
        "test_abstain_rate": float((pt.max(1) < tau).mean()),
        "test_per_class_f1": {c: v["f1"] for c, v in test["per_class"].items()},
        "test_per_class_support": {c: v["support"] for c, v in test["per_class"].items()},
    }


# ---------------------------------------------------------------- one cell of the grid


def run_cell(
    pool: Pool, strategy: str, noise: float, seed: int, cfg: dict, recipe: Recipe
) -> tuple[list[dict], list[dict]]:
    """Rounds 0..R for one (strategy, noise, seed). Returns (round records, manifest rows)."""
    n_classes = len(pool.classes)
    train_idx = np.flatnonzero(pool.split == "train")
    val_idx = np.flatnonzero(pool.split == "val")
    test_idx = np.flatnonzero(pool.split == "test")
    truth = pool.y

    labeled = stratified_initial(
        truth, train_idx, cfg["init_frac"], cfg["init_min_per_class"], seed
    )
    lab_labels = truth[labeled].copy()
    records, manifest = [], []
    cum_corr = 0
    for rnd in range(cfg["rounds"] + 1):
        # Metrics describe the model trained on the labels *before* this round's corrections:
        # "corrections_used" and "n_train_used" are recorded before selection.
        used_corr, n_train_used = cum_corr, len(labeled)
        model = train_mlp(pool.x[labeled], lab_labels, n_classes, seed, recipe)
        lv = logits_of(model, pool.x[val_idx])
        lt = logits_of(model, pool.x[test_idx])
        ls = logits_of(model, pool.x[train_idx])  # scores every train row, labeled or not
        metrics = evaluate(lv, truth[val_idx], lt, truth[test_idx], pool.classes, cfg["target"])
        # Full-pool indexing, so selection can index conf/pred/truth directly.
        p_train = softmax(ls, metrics["temperature"])
        conf_full = np.zeros(len(pool.y))
        pred_full = np.zeros(len(pool.y), dtype=np.int64)
        conf_full[train_idx] = p_train.max(1)
        pred_full[train_idx] = p_train.argmax(1)
        stream = np.setdiff1d(train_idx, labeled)
        stream_conf = conf_full[stream]
        metrics["stream_abstain_rate"] = float((stream_conf < metrics["tau"]).mean())

        new_idx = np.empty(0, dtype=np.int64)
        worker_flipped = 0
        if rnd < cfg["rounds"]:
            if strategy == "none":
                new_idx = np.empty(0, dtype=np.int64)
            else:
                new_idx = select_corrections(
                    strategy,
                    stream=stream,
                    conf=conf_full,
                    pred=pred_full,
                    truth=truth,
                    tau=metrics["tau"],
                    budget=cfg["budget"],
                    wrong_frac=cfg["wrong_frac"],
                    rng=selection_rng(seed, strategy, rnd),
                )
            if len(new_idx):
                answers = worker_labels(
                    truth[new_idx], noise, n_classes, worker_rng(seed, strategy, rnd)
                )
                worker_flipped = int((answers != truth[new_idx]).sum())
                pred_new = pred_full[new_idx]
                for i, a, pr in zip(new_idx, answers, pred_new, strict=True):
                    manifest.append(
                        {
                            "path": pool.paths[i],
                            "round": rnd + 1,
                            "model_label": pool.classes[pr],
                            "model_confidence": round(float(conf_full[i]), 6),
                            "human_label": pool.classes[a],
                            "source": "simulated",
                        }
                    )
                labeled = np.concatenate([labeled, new_idx])
                lab_labels = np.concatenate([lab_labels, answers])
        cum_corr += len(new_idx)
        new_pred = pred_full[new_idx] if len(new_idx) else np.empty(0, np.int64)
        records.append(
            {
                "strategy": strategy,
                "noise": noise,
                "seed": seed,
                "round": rnd,
                "corrections_used": int(used_corr),
                "n_train_used": int(n_train_used),
                "corrections_selected_round": int(len(new_idx)),
                "corrections_selected_cum": int(cum_corr),
                "worker_flipped_round": worker_flipped,
                "model_wrong_round": int((new_pred != truth[new_idx]).sum()) if len(new_idx) else 0,
                **metrics,
            }
        )
    return records, manifest


def run_ceiling(pool: Pool, seed: int, recipe: Recipe) -> dict:
    """Every archive train label, no simulation: the ceiling this recipe can reach."""
    train_idx = np.flatnonzero(pool.split == "train")
    model = train_mlp(pool.x[train_idx], pool.y[train_idx], len(pool.classes), seed, recipe)
    val_idx = np.flatnonzero(pool.split == "val")
    test_idx = np.flatnonzero(pool.split == "test")
    metrics = evaluate(
        logits_of(model, pool.x[val_idx]),
        pool.y[val_idx],
        logits_of(model, pool.x[test_idx]),
        pool.y[test_idx],
        pool.classes,
        0.9,
    )
    return {
        "strategy": "ceiling_all_labels",
        "noise": 0.0,
        "seed": seed,
        "round": 0,
        "corrections_used": 0,
        "n_train_used": int(len(train_idx)),
        "corrections_selected_round": 0,
        "corrections_selected_cum": 0,
        "worker_flipped_round": 0,
        "model_wrong_round": 0,
        **metrics,
    }


def deployed_parity(pool: Pool, deployed: Path) -> dict:
    """The installed probe on the same cached rows, bias removed as installed.

    Must reproduce the stored metrics in head.json (test_macro_f1_no_bias). If it does not,
    the rows or class order do not line up with the deployed head, and nothing else counts.
    """
    import torch
    from safetensors.numpy import load_file

    w = {
        k.removeprefix("probe."): v
        for k, v in load_file(str(deployed / "probe.safetensors")).items()
    }
    head = json.loads((deployed / "head.json").read_text())
    probe = torch.nn.Sequential(
        torch.nn.Linear(*w["0.weight"].shape[::-1]),
        torch.nn.GELU(),
        torch.nn.Dropout(0.0),
        torch.nn.Linear(*w["3.weight"].shape[::-1]),
    )
    probe.load_state_dict({k: torch.from_numpy(v) for k, v in w.items()})  # CPU, eval only
    probe.eval()
    out = {}
    for split in ("val", "test"):
        idx = np.flatnonzero(pool.split == split)
        m = summarize(logits_of(probe, pool.raw[idx]), pool.y[idx], pool.classes, n_pairs=0)
        out[split] = {"n": int(len(idx)), "macro_f1": m["macro_f1"], "top1": m["top1"]}
    out["stored"] = {
        "val_macro_f1_no_bias": head["val_macro_f1"],
        "test_macro_f1_no_bias": head["test_macro_f1"],
    }
    out["parity_gap_test"] = abs(out["test"]["macro_f1"] - head["test_macro_f1"])
    return out


# ---------------------------------------------------------------- driver


def append_jsonl(path: Path, rows: list[dict]) -> None:
    with open(path, "a") as f:
        for r in rows:
            f.write(json.dumps(r, sort_keys=True) + "\n")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument(
        "--features",
        type=Path,
        required=True,
        help="FeatureCache root holding shard_*.npy (fabric, v8 encoder)",
    )
    ap.add_argument("--split-csv", type=Path, default=Path("data/splits/prelim/fabric.csv"))
    ap.add_argument(
        "--deployed-head",
        type=Path,
        default=None,
        help="models/scanner-v8/head_a: parity check and the installed reference",
    )
    ap.add_argument("--out", type=Path, default=Path("training/textilenet/results/retrain_rounds"))
    ap.add_argument("--strategies", nargs="+", default=list(STRATEGIES))
    ap.add_argument("--noise", nargs="+", type=float, default=[0.0, 0.05, 0.10])
    ap.add_argument("--seeds", nargs="+", type=int, default=[0, 1, 2])
    ap.add_argument("--rounds", type=int, default=5)
    ap.add_argument("--budget", type=int, default=2000, help="corrections per round")
    ap.add_argument("--init-frac", type=float, default=0.02)
    ap.add_argument("--init-min-per-class", type=int, default=5)
    ap.add_argument("--wrong-frac", type=float, default=0.2)
    ap.add_argument("--target", type=float, default=0.90, help="abstain accuracy target")
    ap.add_argument("--no-ceiling", action="store_true")
    args = ap.parse_args(argv)

    head_json = (args.deployed_head or Path("models/scanner-v8/head_a")) / "head.json"
    classes = json.loads(head_json.read_text())["classes"]
    pool = load_pool(args.split_csv, args.features, classes)
    counts = {s: int((pool.split == s).sum()) for s in ("train", "val", "test")}
    print(f"pool rows {counts} exclusions {pool.exclusions}", flush=True)

    recipe = Recipe()
    cfg = {
        "rounds": args.rounds,
        "budget": args.budget,
        "init_frac": args.init_frac,
        "init_min_per_class": args.init_min_per_class,
        "wrong_frac": args.wrong_frac,
        "target": args.target,
    }
    out = args.out
    (out / "manifests").mkdir(parents=True, exist_ok=True)
    (out / "runs.jsonl").unlink(missing_ok=True)
    print(f"device {device()}", flush=True)

    parity = deployed_parity(pool, args.deployed_head) if args.deployed_head else None
    if parity:
        print(f"deployed parity: {parity}", flush=True)
    all_records: list[dict] = []
    for seed in args.seeds:
        for strategy in args.strategies:
            noises = [0.0] if strategy == "none" else args.noise
            for noise in noises:
                recs, manifest = run_cell(pool, strategy, noise, seed, cfg, recipe)
                all_records += recs
                append_jsonl(out / "runs.jsonl", recs)  # survives a killed run
                if manifest:
                    write_manifest(
                        manifest, out / "manifests" / f"{strategy}_noise{noise:.2f}_seed{seed}.csv"
                    )
                last = recs[-1]
                print(
                    f"seed {seed} {strategy:8s} noise {noise:.2f}: "
                    f"val F1 {last['val_macro_f1']:.4f} test F1 {last['test_macro_f1']:.4f} "
                    f"corr {last['corrections_used']}",
                    flush=True,
                )
        if not args.no_ceiling:
            all_records.append(run_ceiling(pool, seed, recipe))
            append_jsonl(out / "runs.jsonl", all_records[-1:])
            print(f"seed {seed} ceiling test F1 {all_records[-1]['test_macro_f1']:.4f}", flush=True)

    out.mkdir(parents=True, exist_ok=True)
    scalar = [k for k, v in all_records[0].items() if not isinstance(v, dict)]
    with open(out / "runs.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=scalar, extrasaction="ignore")
        w.writeheader()
        w.writerows(all_records)

    run_meta = {
        "config": cfg,
        "recipe": asdict(recipe),
        "strategies": args.strategies,
        "noise": args.noise,
        "seeds": args.seeds,
        "classes": classes,
        "pool_rows": counts,
        "exclusions": pool.exclusions,
        "split_csv": str(args.split_csv),
        "split_sha256": sha256(args.split_csv),
        "wrong_frac_note": "confident-wrong slot uses the true label (oracle spot-check)",
        "encoder_note": "frozen v8 SigLIP features; the encoder was trained on the same train rows",
    }
    if args.deployed_head:
        run_meta["deployed_head"] = str(args.deployed_head)
        run_meta["parity"] = parity
    (out / "run_meta.json").write_text(json.dumps(run_meta, indent=2, sort_keys=True))
    print(f"wrote {out}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
