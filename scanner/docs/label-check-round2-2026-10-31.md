# Label check round 2 — 31 Oct 2026

Judges: Zuhair (1,151, median 16 s/photo) and Fahad (506, median 3 s) are treated as human. Claude and DeepSeek files are machine-filled (no timings / flat timings) and are NOT used. Files: runs/human_verify/round2/ (merged.csv, verified_conservative.csv, predict_v8.py).

scanner-v8 (whole photo) on the 1,151 survey photos, macro F1 / top-1:

| Set | n | macro F1 | top-1 |
| --- | ---: | ---: | ---: |
| Raw archive labels | 1151 | 0.752 | 0.748 |
| Human-judged, Zuhair/Fahad corrections used | 785 | 0.791 | 0.776 |
| Conservative: label confirmed yes, or fix both humans agree on | 641 | 0.886 | 0.886 |
| Two humans agree (both saw it) | 270 | 0.880 | 0.881 |

Photos the judges disputed or marked unclear are excluded, so these are scores on unambiguous photos (counting them all wrong gives a 0.603 floor).

Patterns:
- Archive label noise is concentrated: label-right rate serge 0%, chenille 24%, crepe 30%, flannel 36%, faux_fur 38%, taffeta 42%, organza 42%, corduroy 42%, gingham 44% (vs faux_leather 92%, knit 84%).
- The "no" verdict is reliable; the replacement class is not. Zuhair picks knit for 40% of corrections (Fahad 17%); where both said no they chose the same class only 36% of the time (Zuhair knit vs Fahad fleece/chenille). Model sides with the original label on 49% of the corrected photos.
- Training-clean plan: drop or down-weight photos in the noisy classes before the LoRA retrain; do not relabel from single-judge "knit" fixes.
