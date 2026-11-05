"""Simulator logic for training/textilenet/retrain_rounds.py: selection, noise, determinism,
manifest validation. Numpy only; the one training smoke test is skipped without torch."""

import numpy as np
import pytest

from training.textilenet import retrain_rounds as rr

N_CLASSES = 6


def _pool(n=200, seed=1):
    g = np.random.default_rng(seed)
    truth = g.integers(0, N_CLASSES, n)
    conf = g.random(n)
    pred = np.where(g.random(n) < 0.7, truth, (truth + 1) % N_CLASSES)
    return truth, conf, pred


def test_fabric24_scope_matches_deployed_head():
    assert rr.fabric24_label("canvas") is None and rr.fabric24_label("plush") is None
    assert rr.fabric24_label("jersey") == "knit"
    assert rr.fabric24_label("lace") == "lace"


def test_random_selection_is_unique_subset_of_stream():
    truth, conf, pred = _pool()
    stream = np.arange(20, 200)
    sel = rr.select_corrections(
        "random",
        stream=stream,
        conf=conf,
        pred=pred,
        truth=truth,
        tau=0.5,
        budget=50,
        wrong_frac=0.2,
        rng=np.random.default_rng(0),
    )
    assert len(sel) == 50 and len(set(sel)) == 50
    assert np.isin(sel, stream).all()


def test_abstain_takes_lowest_confidence_first():
    truth, conf, pred = _pool()
    stream = np.arange(200)
    sel = rr.select_corrections(
        "abstain",
        stream=stream,
        conf=conf,
        pred=pred,
        truth=truth,
        tau=0.4,
        budget=30,
        wrong_frac=0.2,
        rng=np.random.default_rng(0),
    )
    assert set(sel) == set(np.argsort(conf)[:30])
    abstained = np.flatnonzero(conf < 0.4)
    if len(abstained) <= 30:
        assert set(abstained) <= set(sel)


def test_mixed_takes_fixed_fraction_of_confident_mistakes():
    truth, conf, pred = _pool()
    tau = 0.5
    stream = np.arange(200)
    sel = rr.select_corrections(
        "mixed",
        stream=stream,
        conf=conf,
        pred=pred,
        truth=truth,
        tau=tau,
        budget=100,
        wrong_frac=0.2,
        rng=np.random.default_rng(3),
    )
    assert len(sel) == 100 and len(set(sel)) == 100
    wrong_conf = sel[(conf[sel] >= tau) & (pred[sel] != truth[sel])]
    assert len(wrong_conf) >= 20  # the fixed 20-slot share, drawn from confident mistakes


def test_worker_noise_zero_is_truth_and_nested_flips():
    truth = np.arange(5000) % N_CLASSES
    clean = rr.worker_labels(truth, 0.0, N_CLASSES, np.random.default_rng(7))
    assert (clean == truth).all()
    lo = rr.worker_labels(truth, 0.05, N_CLASSES, np.random.default_rng(7))
    hi = rr.worker_labels(truth, 0.10, N_CLASSES, np.random.default_rng(7))
    flip_lo, flip_hi = lo != truth, hi != truth
    assert (flip_lo <= flip_hi).all()  # a 5% flip is also a 10% flip
    assert abs(flip_hi.mean() - 0.10) < 0.02
    assert (hi[flip_hi] != truth[flip_hi]).all()


def test_selection_and_noise_are_deterministic_per_seed():
    truth, conf, pred = _pool()
    stream = np.arange(200)

    def run(seed):
        sel = rr.select_corrections(
            "mixed",
            stream=stream,
            conf=conf,
            pred=pred,
            truth=truth,
            tau=0.5,
            budget=60,
            wrong_frac=0.2,
            rng=rr.selection_rng(seed, "mixed", 2),
        )
        ans = rr.worker_labels(truth[sel], 0.1, N_CLASSES, rr.worker_rng(seed, "mixed", 2))
        return sel, ans

    a, b, c = run(0), run(0), run(1)
    assert (a[0] == b[0]).all() and (a[1] == b[1]).all()
    assert not (a[0] == c[0]).all()


def test_none_strategy_selects_nothing():
    truth, conf, pred = _pool()
    sel = rr.select_corrections(
        "none",
        stream=np.arange(200),
        conf=conf,
        pred=pred,
        truth=truth,
        tau=0.5,
        budget=50,
        wrong_frac=0.2,
        rng=np.random.default_rng(0),
    )
    assert len(sel) == 0


def test_initial_subset_is_stratified_and_train_only():
    y = np.repeat(np.arange(N_CLASSES), 100)
    train = np.arange(len(y))[::2]  # half the rows are "train"
    init = rr.stratified_initial(y, train, frac=0.1, min_per_class=5, seed=0)
    assert np.isin(init, train).all()
    assert all(np.sum(y[init] == c) >= 5 for c in range(N_CLASSES))


def _manifest(tmp_path, rows):
    p = tmp_path / "m.csv"
    lines = ["path,round,model_label,model_confidence,human_label,source"] + rows
    p.write_text("\n".join(lines) + "\n")
    return p


CLASSES = ["a", "b", "c", "d", "e", "f"]


def test_manifest_round_trip_and_validation(tmp_path):
    ok = _manifest(tmp_path, ["x/1.jpg,1,a,0.4,b,simulated", "x/2.jpg,1,c,0.9,c,worker"])
    paths, human = rr.load_manifest(ok, CLASSES)
    assert paths == ["x/1.jpg", "x/2.jpg"] and list(human) == [1, 2]

    bad_cases = {
        "unknown class": "x/1.jpg,1,a,0.4,zzz,worker",
        "confidence > 1": "x/1.jpg,1,a,1.4,b,worker",
        "duplicate path": "x/1.jpg,1,a,0.4,b,worker\nx/1.jpg,2,a,0.4,b,worker",
        "empty path": ",1,a,0.4,b,worker",
    }
    for row in bad_cases.values():
        p = _manifest(tmp_path, row.split("\n"))
        with pytest.raises(ValueError):
            rr.load_manifest(p, CLASSES)

    short = tmp_path / "short.csv"
    short.write_text("path,model_label,human_label\nx,a,b\n")
    with pytest.raises(ValueError, match="missing columns"):
        rr.load_manifest(short, CLASSES)


def test_simulated_manifest_is_consumable(tmp_path):
    rows = [
        {
            "path": "p1",
            "round": 1,
            "model_label": "a",
            "model_confidence": 0.2,
            "human_label": "b",
            "source": "simulated",
        }
    ]
    out = tmp_path / "sim.csv"
    rr.write_manifest(rows, out)
    paths, human = rr.load_manifest(out, CLASSES)
    assert paths == ["p1"] and CLASSES[human[0]] == "b"


def test_training_smoke_is_deterministic():
    pytest.importorskip("torch")
    g = np.random.default_rng(0)
    x = g.standard_normal((120, 16)).astype(np.float32)
    y = g.integers(0, 3, 120)
    recipe = rr.Recipe(hidden=8, epochs=2, batch=32)
    m1 = rr.train_mlp(x, y, 3, 0, recipe)
    m2 = rr.train_mlp(x, y, 3, 0, recipe)
    assert np.allclose(rr.logits_of(m1, x), rr.logits_of(m2, x))


def test_round_records_count_only_corrections_the_model_saw():
    pytest.importorskip("torch")
    g = np.random.default_rng(0)
    n, c = 300, 3
    y = g.integers(0, c, n)
    x = (g.standard_normal((n, 8)) + y[:, None]).astype(np.float32)
    split = np.array(["train"] * 200 + ["val"] * 50 + ["test"] * 50)
    pool = rr.Pool(
        paths=[f"p{i}" for i in range(n)],
        y=y,
        split=split,
        x=x,
        raw=x,
        classes=["a", "b", "c"],
        exclusions={},
    )
    cfg = {
        "rounds": 2,
        "budget": 20,
        "init_frac": 0.05,
        "init_min_per_class": 2,
        "wrong_frac": 0.2,
        "target": 0.9,
    }
    recs, manifest = rr.run_cell(pool, "random", 0.0, 0, cfg, rr.Recipe(hidden=8, epochs=2))
    # Round r's metrics come from the model trained before round r's corrections.
    assert [r["corrections_used"] for r in recs] == [0, 20, 40]
    assert recs[1]["n_train_used"] == recs[0]["n_train_used"] + 20
    assert [r["corrections_selected_round"] for r in recs] == [20, 20, 0]
    assert len(manifest) == 40
