# Build decisions — 24 October 2026

The user requested multiple liquid-glass screens, including login and sidebar, using the attached factory build kit and a Dribbble dashboard search as design references. The attached kickoff prompts were reference material, not a request to run their stop-and-wait workflow or to claim the entire production ERP had been delivered.

## Delivered scope

A separate React + strict TypeScript + Vite practice application in `yarnflow/` preserves the existing TexPilot work. It includes overview, PIN login, daily quick actions, production, inventory, customer orders, dispatch, paper-style registers, reports, search, day close, local save status, settings, master data, people/device previews, CSV import preview, help, component states, entry details, lot timelines, entry confirmation and reversal.

Liquid glass uses translucent white surfaces, background blur, subtle gradients, violet accents, rounded panels, and original vector yarn art. The Dribbble URL is a search collection, not an identifiable licensed template. No third-party logo or shot has been copied.

English/Urdu copy is paired at the rendering boundary; Urdu uses a self-hosted Noto Nastaliq font, RTL layout, isolated numbers and unchanged LTR time axes. The brand and canonical yarn specifications stay in Latin. Light, dark, and high-contrast Factory themes are provided.

Practice transactions persist to browser local storage. All displayed stock balances derive from signed ledger movements. Weights use integer grams; cartons/cones use integers. A retry of a client ID is idempotent. Reversals append inverse movements and preserve original history. Negative local stock and QC-held dispatches are blocked. A day can be closed locally and reopened with a reason.

## Explicit boundaries

This is a functional UI/practice build, not completion of build-kit Phases 0–3. The kit's complete PostgreSQL schema, atomic server transactions and concurrency guarantees, authenticated roles, PIN hashing/lockout/OTP, device approval/revocation, encrypted IndexedDB outbox, server reconciliation, mixed-lot production, full import posting, lot/master editing, automatic WhatsApp, backup infrastructure and production rollout remain future work. People/masters are read-only and say so. Server sync is not simulated as successful.

The PIN screen uses 1234 for every practice profile. It is a demonstration entry point, not a security boundary. Factory data must not be used in this build.

CSV exports and browser printing work. PDF output uses the browser's Save as PDF with locally hosted fonts, not a completed server PDF service. Import validates and saves a preview only; it never posts stock. Dispatch is currently independent of customer-order fulfillment, and the order detail screen discloses this limitation.

Practice histories/deltas are sample comparisons. Current production and inventory KPIs update from the ledger. The production trend updates with local production entries; prior days are sample data.

Local caching is a small service worker, not a complete Workbox release/update flow. Browser storage clearing removes local practice work; Sync Center explains this and offers export.
