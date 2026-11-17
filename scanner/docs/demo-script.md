# Demo script: scan material and review the result

## Live flow

1. Sign in to Yarnflow and select **Scan**.
2. In the capture panel, choose **Fabric / garment** and open the camera or upload a photo.
3. Optionally choose **Care label** and add a label photo, or type its composition.
4. Select **Analyze material**.
5. Show the result rows that have output: **Fabric**, **Composition**, **Finish**, and **Pattern**. The screen also shows a garment result when available, a verdict, and confidence values. It always shows the model's top answer; it has no correction or review-queue flow.
6. Confirm with **Confirm result**. Select **Measure yarn count** only if you want to open the separate measurement flow.

The scanner's camera-photo performance has not been established by the catalog test. Do not describe catalog results as factory-phone results.

## Preparation

- Start the scanner API using the instructions in [scanner/README.md](../README.md#run-the-real-scanner-m1-demo-apple-silicon-mac).
- Start Yarnflow using [yarnflow/README.md](../../yarnflow/README.md#run-locally).
- Choose a garment photo and, optionally, a care-label photo. Do not promise a specific prediction or verdict.
- Keep the screen connected to the scanner API. If it is unavailable, state that the scan is offline; do not present a saved result as a live scan.

## Results to cite

For the deployed fabric Head A on the TextileNet catalog test set, macro F1 is 0.7666 and top-1 accuracy is 82.2% (n=24,303; `scanner/models/scanner-v8/head_a/head.json`). These are catalog results, not phone-photo results. The separate 27-class DINOv2 linear structure head has test macro F1 0.5428 and top-1 accuracy 74.4% (n=40,970; `scanner/models/scanner-v8/bundle.json`).
