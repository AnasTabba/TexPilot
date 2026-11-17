# Yarnflow

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: the examiners and supervisors of the TexPilot final year project (IBA, CSE 493/494), who judge the work from a live demo. The demo tells a factory story: FAZ Textile Factory's owner and floor operators use phones to check fabric and run yarn stock and QC.

Secondary: the project team, who install the app as a Home Screen web app on their iPhones and test it on the factory wifi or LAN.

## Product Purpose

Yarnflow is the stock and quality workspace; TexPilot is the fabric scanner inside it. Point a phone at a garment or fabric and get what it is: garment, fabric, what it is made of, the mix, and the finish. That answer feeds goods-in QC for a batch, and the batch's stock moves through receiving, production, approval and dispatch.

Success is a demo in which every answer on screen visibly comes from the project's own trained models, label reads or measurements, and the stock it acts on stays correct.

## Positioning

The answers come from the project's trained vision models (scanner-v8 for fabric, plus shop-photo heads for garment, fibre, mix and finish). Display labels are translated for buyers, and the fibre-family mapping may supply a candidate fibre; that candidate is not a separate fibre-head prediction. Each model answer carries its confidence. The analysed photo and detector box appear under Details.

## Operating Context

Role menus include Dashboard, Stock and Scan; supervisors see History and admins see Activity. Help is available to all roles. Settings opens from the top-right gear. Stock is one page (material, then its batches) with filters for Needs QC, In production and To dispatch.

Stock workflows: add a material, create a dye lot or batch, receive and move integer-gram quantities between stages, record inspection evidence, get owner QC approval before dispatch, and correct mistakes with reversals that keep the original entry.

Scanning: the Scan page opens on the capture flow, with **Fabric / garment** and **Care label** photo controls. The scanner API runs from `scanner/` with `make api-scanner` (port 8000); the phone reaches it over the network. A published HTTPS app needs an HTTPS scanner URL. **Measure yarn count** opens a separate measurement flow. Barcode/QR lookup and manual inspection work without model inference.

## Capabilities and Constraints

- Every scan answer shows its top result with the model's own confidence as a colour-coded %. There is no "not sure" state; the % carries the doubt. Closest alternatives, the analysed photo and per-model timings sit under Details.
- Composition is said in trade terms (cotton, PC, CVC, polyester, with stretch where present); garments use local names (T-shirt, dupatta).
- Scan output includes model predictions, label reads, translated display labels and measurements. Some results also use label-guided family mappings and illustrative artwork.
- A scan never approves a batch by itself. QC approval is an owner action.
- No wash-type model or wash result is currently available.
- Stock and accounts live in one shared Cloudflare D1 database. Everyone signs in with a name and PIN and sees the same stock; admins choose recording permissions. Draft forms and the language preference are local convenience state. The live database contains real entries only. Inspection photo upload is not implemented yet.
- English and اردو are selectable on sign-in and in Settings. The choice persists locally; Urdu uses right-to-left layout while PINs, quantities and identifiers keep their intended order.
- `ios/` holds a separate native iOS Yarnflow app from the team's 25 Oct work; this record covers the web app.

## Brand Commitments

Name Yarnflow (wordmark "yarnflow.", logo at `public/brand/logo.png`); the scanner is TexPilot; the demo workspace is FAZ Textile Factory. Voice is plain and short in the trade's own words. Screens carry only what the user needs to act; the user has rejected crowded scan cards.

## Evidence on Hand

Model results and test sets are in `../scanner/docs/results.md`, `../scanner/docs/factory-guide.md` and `../scanner/docs/phone-test-set.md`; the archive label audit is in `../scanner/runs/label_audit`. Results are reported macro F1 first, then accuracy, and name the domain they were measured on (catalogue or shop product photos).

Absent, and not to be fabricated: accuracy on factory phone photos, a wash-type model, customers, testimonials or deployment claims.

## Product Principles

1. Real output only: if a model, label or measurement did not produce it, it does not appear.
2. Always answer, and show how sure: the top result leads; its % says how far to trust it.
3. One answer per question up front; evidence one tap away under Details.
4. Stock history is never rewritten: corrections are reversals, and dispatch waits for QC approval.
5. Accuracy claims name their test set, because catalogue photos are not factory phone photos.
