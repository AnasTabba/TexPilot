# TexPilot in the factory

## Scan a material

In Yarnflow, open **Scan**. Choose **Fabric / garment** and take or upload a clear photo. Add a **Care label** photo if available, or enter the composition as text. Select **Analyze material**.

The result can show **Fabric**, **Composition**, **Finish**, and **Pattern**, along with a garment result and verdict when available. The current screen displays the model's top answer and confidence; it does not offer a correction queue. If the scanner cannot judge the label consistency, follow the verdict and inspect the material yourself.

On the TextileNet catalog test set, the installed scanner-v8 SigLIP Head A has macro F1 0.7666, top-1 accuracy 82.2%, and n=24,303 (`models/scanner-v8/head_a/head.json`). This is not a measurement on factory phone photos. The separate DINOv2 linear structure head uses 27 TextileNet classes and scores macro F1 0.5428 and top-1 accuracy 74.4%, n=40,970 (`models/scanner-v8/bundle.json`). Head A has 24 classes; it does not include canvas, jersey, or plush (`models/scanner-v8/head_a/head.json`).

## Measure yarn count

After a scan, select **Measure yarn count** to open the separate measurement flow. Follow its on-screen instructions and provide the required scale and fabric weight. Do not treat an example value or simulated measurement as a verified production result.

## Limits

The repository contains no measured factory-phone accuracy result. Check fabric and yarn measurements against your normal inspection tools before using them for an order decision.
