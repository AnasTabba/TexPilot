# Reviewer 10 — training, DDP and reproducibility

Recommendation: revise T09/T10 before implementation acceptance. No P0 found; two P1 acceptance gaps and one P2 reproducibility gap follow. This is an independent source review, not GPU validation or authorization to train.

## Inspected paths

- `scanner/docs/superpowers/specs/2026-11-12-incoming-fabric-qc-design.md` (especially §§2,8,12 and integrated research requirements).
- `scanner/docs/superpowers/plans/2026-11-12-incoming-fabric-qc.md` (T09–T12, proof matrix and integrated acceptance details).
- `scanner/training/textilenet/{train,data,splits}.py`.
- `scanner/training/fault/methods/dinomaly.py`, `scanner/training/fault/kaggle/full_a2.py`.
- `scanner/tests/test_fault_dinomaly_ddp.py`, `scanner/docs/fault-a2-ddp-2026-11-12.md`.

## P1 — T10 green command can omit its required numerical DDP proof

**Existing evidence:** `scanner/tests/test_fault_dinomaly_ddp.py:72–77` skips the real two-process regression unless `DINOMALY_REPO` is set. Its loss loader at lines 18–29 reads arbitrary local `utils.py` without checking the upstream commit/hash. The numerical test uses a small Conv2d, AdamW and three Gloo updates (lines 39–66); it does not execute the production StableAdamW/AMP/NCCL fit loop. Production uses StableAdamW at `scanner/training/fault/methods/dinomaly.py:231–240` and NCCL at lines 399–416.

**Proposed contradiction:** design §8 requires pinned upstream and separately validated two-process gradient equivalence; T10 step 2 (`plans/...incoming-fabric-qc.md:161`) supplies neither the environment prerequisite nor a no-skip gate. A successful pytest exit can therefore be recorded as T10 green without its essential numerical assertion, or against a different upstream loss. The historical 66-test report is not proof for a future changed bundle.

**Correction:** retain optional baseline tests, but give T10 a mandatory numerical-proof invocation with a verified upstream SHA/hash and an explicit executed/not-skipped assertion. Name its scope as global-mining/gradient regression; retain a separate authorized production-loop NCCL/AMP proof artifact, not an inference from the toy test.

**Test assertion:** unset/missing/wrong-SHA upstream makes the T10 proof gate fail; a pinned checkout executes the named two-rank test and records its result. Missing hardware report remains G6 pending and cannot become a speedup claim even when CPU proof passes.

## P1 — Sealed manifest is not yet enforced at the reused classifier input boundary

**Existing evidence:** `scanner/training/textilenet/data.py:67–90` warns and removes missing files, accepts only train/val/test into its output, and permits per-class truncation across all splits. `scanner/training/textilenet/train.py:235–236` directly consumes that loader. The existing `Record` has only path/label/split/source/SHA1 (`scanner/training/textilenet/splits.py:64–70`), not the proposed grouped QC manifest or a calibration/release partition. Training automatically evaluates test and writes test logits/metrics at `train.py:500–541`.

**Proposed gap:** design §8 and T09 promise immutable grouped train/validation/calibration/release manifests; T10 says reuse this pipeline, but its exact assertions do not require the adapter to fail on missing/changed files, reject smoke truncation, or keep release rows out of ordinary training/test evaluation. An audited manifest can differ from the cohort actually consumed while the existing code continues normally. This is an existing legacy convenience, not a claim that QC currently exists.

**Correction:** make the proposed QC `train_manifest` boundary verify every referenced image/mask hash and partition before fitting, pass only explicit train/selection-validation rows to the existing trainer, and reserve calibration/release for their owning stages. Preserve permissive legacy benchmark behavior outside QC. Record actual consumed IDs and counts, requiring equality to the sealed intended subset; unavailable inputs invalidate the run rather than silently changing the cohort.

**Test assertion:** deleting or changing one sealed input fails before model construction; a calibration/release sentinel never reaches fit, early stopping, TTA selection or ordinary test-logit export; truncation flags fail for confirmatory runs; consumed IDs/hash/count exactly match the intended manifest subset.

## P2 — Clarify classifier resume reproducibility rather than inheriting an incomplete claim

**Existing evidence:** classifier resume restores only CPU torch and sampler-generator RNG (`scanner/training/textilenet/train.py:357–366`); saved `last.pt` contains those two RNG states only (lines 482–494). Python/NumPy, CUDA and persistent worker/augmentation streams are not restored. Workers independently seed NumPy/Python/Albumentations (`scanner/training/textilenet/data.py:54–64`), and persistent workers are enabled at `train.py:283`. Consequently resumed augmentation/dropout trajectories need not match uninterrupted training, even apart from the acknowledged cudnn benchmark nondeterminism (`train.py:560–564`).

**Proposed gap:** design §8 correctly disclaims bitwise reproducibility and optimizer resume from fault inference checkpoints, but T10's reproducible bundle/register does not specify whether classifier resumed runs are continuations or new trajectories. Merely recording a seed and command cannot distinguish them.

**Correction:** simplest option: mark resumed classifier runs explicitly as non-trajectory-equivalent, bind the parent checkpoint hash, resumed epoch, optimizer/scaler state and resume command in run provenance, and prohibit pooling them as fresh independent seeds. If exact continuation is required later, implement and prove the relevant RNG/worker replay contract in the owning trainer rather than implying it now.

**Test assertion:** a resumed run cannot enter the experiment register without parent hash and resume metadata; fresh seed and resumed child cannot count as two independent seed replicates. Any exact-continuation claim requires an interrupted-versus-uninterrupted comparison under a documented supported deterministic execution profile.

## Proof and external gates

Read-only Python AST/text checks confirmed the optional DDP marker, missing-row filtering and classifier RNG-state calls; no dependencies were installed and no training/GPU/Kaggle commands were run. Existing DDP source does implement global batch partitioning, global hard-mining communication, synchronized successful-update accounting and portable inference restoration; the draft appropriately avoids claiming measured NCCL speedup or optimizer resume from those checkpoints. G4 rights/consent, G5 AITEX adjudication, G6 actual artifact/hardware proof and fresh quota/authorization remain external gates, not approvals supplied by this review; no active-job status or quota was revalidated here.
