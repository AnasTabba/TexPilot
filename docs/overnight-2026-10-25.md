# TexPilot morning report — 25 October 2026

Updated 2026-10-25T08:32:39+05:00.
Live scanner: **scanner-v5+det=owlv2+ocr=apple**. Readiness: `{"ready": true, "mode": "scanner", "model_version": "scanner-v5+det=owlv2+ocr=apple"}`.

## Model decision
Installed scanner-v5: the three-seed mean and the fixed packaged seed 0 improve validation macro F1 and both archive test metrics over v4.

Proven v4 baseline: archive/catalog domain, n=24,628, top-1 **0.7826**, macro F1 **0.6174**; answers 68.7% at 90.1% accuracy. These are not phone-photo accuracy figures.

SigLIP 2 frozen encoder + MLP, hidden 1024, dropout 0.2, 30 epochs; lr/wd and epoch selected on validation macro F1. Width sweep was canceled for laptop safety before a result, so the previously measured DINOv2 configuration was fixed in advance. No test-driven retuning.

| Candidate | Validation macro F1 | Archive test top-1 | Archive test macro F1 |
|---|---:|---:|---:|
| Three-seed mean | 0.6765 | 0.8009 | 0.6582 |
| Packaged seed 0 (fixed beforehand) | 0.6813 | 0.7965 | 0.6553 |

Deployment requires the validation macro F1 and both test metrics to improve for both the mean and the actual packaged seed 0. 

## Careful scan
Views selected using 600 validation archive photos only: **full**. Test evaluation is restricted to the baseline and this frozen selection (600 archive photos).

| Views | Test top-1 | Test macro F1 | Answered | Accuracy on answers | Passes |
|---|---:|---:|---:|---:|---:|
| full | 0.7883 | 0.6423 | 81.0% | 85.4% | 1 |

Chosen minus baseline: +0.00 percentage points; paired-bootstrap 95% interval [+0.00, +0.00]. When the single full view wins, this zero delta is the baseline compared with itself, not an independent estimate of an augmentation effect. No serving change was made for this exploratory experiment; the original full-validation production threshold is retained, rather than the threshold refitted on only 600 validation images.

## Yarn specification and evidence
The printed card supplies scale and perspective correction; the app reports thread density, a weave interpretation, and an estimated yarn-count range from supplied fabric weight. The earlier thread-count and weave checks used simulated fabric, including a tilted synthetic phone image. This does not establish real-phone measurement accuracy. A real phone photo and a pick-glass comparison remain required. Warp/weft yarn count uses a same-count assumption and assumed crimp; confirm the weft by unravelling and measuring it. Fibre comes from the care label, rather than being established by appearance.

Print `yarn-erp/public/texpilot-card.svg` at actual size (100%); verify the marker measures 30 mm.

## Fresh checks
- Default Python test suite: exit 0; two skips, no failures.
- App: 37/37 tests; TypeScript check passed.
- Ruff: all checks passed.

Live smoke checks:

```json
{
  "scan": {
    "ok": true,
    "errors": [],
    "model_version": "scanner-v5+det=owlv2+ocr=apple",
    "structure": null,
    "candidates": {
      "structure": [
        [
          "chenille",
          0.2152239829301834
        ],
        [
          "serge",
          0.1559310257434845
        ],
        [
          "tweed",
          0.10089002549648285
        ]
      ]
    },
    "scale_source": null,
    "weave": null,
    "yarn_order": null
  },
  "spec": {
    "ok": true,
    "errors": [],
    "model_version": null,
    "structure": null,
    "candidates": null,
    "scale_source": "card",
    "weave": "3/1 twill, right-hand",
    "yarn_order": [
      "Warp yarn: Ne 7s (range 6.6-7.1), 98% cotton + 2% elastane/spandex",
      "Weft yarn: Ne 7s (range 6.6-7.1), 98% cotton + 2% elastane/spandex",
      "Construction: woven 3/1 twill, right-hand, 64 ends x 42 picks per inch, 390 g/m2 (11.5 oz/yd2)"
    ]
  }
}
```

Logs and structured results: `data/logs/overnight_*`, `data/logs/heads_siglip2.log`, `data/logs/scanner_morning.log`, and `runs/overnight_20261025/`.

## v4 per-class archive performance

| Class | Test images | F1 | Recall |
|---|---:|---:|---:|
| canvas | 4 | 0.0000 | 0.0000 |
| chambray | 294 | 0.6588 | 0.6633 |
| chenille | 207 | 0.6097 | 0.5169 |
| chiffon | 5686 | 0.8540 | 0.8757 |
| corduroy | 265 | 0.7746 | 0.7585 |
| crepe | 239 | 0.4536 | 0.4393 |
| denim | 1711 | 0.8570 | 0.8650 |
| faux_fur | 1178 | 0.8829 | 0.8964 |
| faux_leather | 331 | 0.8613 | 0.8912 |
| flannel | 292 | 0.6851 | 0.6781 |
| fleece | 562 | 0.6518 | 0.7028 |
| gingham | 380 | 0.7667 | 0.7395 |
| jersey | 228 | 0.5000 | 0.4737 |
| knit | 1829 | 0.7613 | 0.7988 |
| lace | 6913 | 0.8332 | 0.8419 |
| lawn | 209 | 0.7886 | 0.7943 |
| neoprene | 60 | 0.7477 | 0.6667 |
| organza | 601 | 0.5961 | 0.5524 |
| plush | 57 | 0.0984 | 0.0526 |
| satin | 1484 | 0.6379 | 0.6125 |
| serge | 127 | 0.5020 | 0.5039 |
| taffeta | 197 | 0.5852 | 0.5228 |
| tulle | 756 | 0.4321 | 0.3664 |
| tweed | 292 | 0.7700 | 0.7911 |
| twill | 5 | 0.0000 | 0.0000 |
| velvet | 675 | 0.7118 | 0.6548 |
| vinyl | 46 | 0.6506 | 0.5870 |

Canvas and twill each have fewer than ten archive test examples and F1 zero. Plush is also weak. Overall accuracy conceals these gaps. The synthetic weave reader is a separate measurement path and does not repair these classifier results.
