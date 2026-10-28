"""Validation ranking must respect the requested objective and chosen TTA."""

from training.textilenet.aggregate import ranking_score


def test_macro_f1_ranking_uses_selected_validation_view():
    run = {
        "best": {"val_top1": 0.80},
        "tta": True,
        "val": {"plain": {"macro_f1": 0.65}, "tta": {"macro_f1": 0.70}},
    }
    assert ranking_score(run, "top1") == 0.80
    assert ranking_score(run, "macro_f1") == 0.70


def test_macro_f1_ranking_without_tta_uses_plain():
    run = {"best": {"val_top1": 0.80}, "tta": False, "val": {"plain": {"macro_f1": 0.65}}}
    assert ranking_score(run, "macro_f1") == 0.65
