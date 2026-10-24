# Yarnflow

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users and purpose

The user and a friend need a shared inventory application they can install as a Home Screen web app on their iPhones and use for ongoing testing. The repository's domain is yarn/fabric inventory, batch traceability, goods-in verification and factory stock movements.

## Existing product context

The existing React application and its Yarnflow identity are retained. The earlier bilingual browser-local practice interface remains separate at `/?practice=1`. The shared app starts empty and does not convert practice samples into live stock.

## Workflows

Create or join a shared workspace; add a material/SKU; create a dye lot; receive and move integer-gram quantities between stock stages; record inspection evidence; obtain owner QC approval before dispatch; preserve corrections as reversals. Scan a printed QR label or product barcode to find the correct batch. Each phone reads the same server-backed stock.

## Access and stock authority

The existing Site remains private and supplies account identity. A friend needs both Site access and an app workspace invitation. Owners approve QC and invite operators. Operators perform stock work and record evidence.

The delivered hosted app's stock authority is the Yarnflow ledger, stored in Cloudflare D1. Inspection photos live in R2. InvenTree is the recommended upstream backend candidate; its optional connection check is not a stock migration or synchronization.

## Model boundary

TexPilot is an independent fabric-verification service. Its trained model files were absent during this implementation. Barcode scanning and manual inspections work independently. The app must not invent fabric predictions, infer exact fibre percentages from an ordinary photo, or automatically approve a batch from client-supplied results.

## Operating constraints

The hosted application must remain usable while the Mac is off. Reads refresh across devices; writes require a network and explicit server confirmation. Drafts are local convenience state, not authoritative stock. Audit records and exported evidence must not silently disappear because of overview pagination.

## Evidence and open choice

The implemented UI, SQL, tests, screenshot captures and setup documentation are in this project. GitHub repository candidates and their verified maintenance signals are in `docs/BACKEND-OPTIONS.md`. The user's final upstream ERP choice is open. Physical iPhone camera behavior and trained-model inference require actual devices and the recovered model bundle for acceptance.
