---
version: 1
slug: "src-liveapp-tsx"
primary_target: "src/LiveApp.tsx"
related_targets: ["src/WorkspaceDashboard.tsx","src/Scanner.tsx","src/SpecScan.tsx","src/BarcodeScanner.tsx"]
---

Scope: the whole Yarnflow web app (Home, Stock, batch detail, stock forms, Scan with Fabric / Yarn count / Stock label, History, Settings, Help, welcome and loading). Mode: Operate. Laptop / projector first for the demo; phone layout must work too. The native iOS app follows the same world afterwards.

Audience and job: the FAZ Textile Factory owner and floor operators (and the examiners watching the demo). Jobs: see what is on hand, inspect or release batches, receive and move stock, scan a fabric. Constraints: real model output only; no crowded dashboards, no generic SaaS template, nothing playful or decorative. Keep the animated garment and fabric pictures (ScannerArtwork) and the loom loader.

## Direction contract

THESIS: Mills tell yarn apart by the colour of its cone tube; Yarnflow gives each material its own tube colour and carries it everywhere that material appears. It refuses the KPI-tile dashboard (icon-in-circle cards, lime on charcoal) the app had.

OWN-WORLD: warm light-grey ground (#f5f4f2; amended from #f6f4f1 after the finish review, which sits over the taste inspector's yellow-cream line), white panels with a 1px warm edge, 10px panel and 8px control corners, an ink (#1d1b19) sidebar and near-black primary buttons, kraft (#b98a5c) cone tubes, material hues blue, pink, teal, charcoal, sienna, slate; QC states as pale tints with a word and an icon; Figtree with tabular figures.

STORY: The owner opens Home and reads stock by material, which batches wait for QC and what moved last; inspecting or scanning is one click. Operators recognise a material by its cone colour on every screen.

FIRST VIEWPORT (revised 26 Oct after the user asked for a less boxy, flowing, guided design): ink sidebar 240px with pill nav and recognisable icons (cone for Stock); one white sheet curving out of it (28px radius), no boxed cards. Home: title + date, then a tinted "Next up" field naming the single next action (QC hold, inspection, or all clear) with its primary button and Scan fabric; then Stock flow, four stage nodes on a moving kraft thread; then Materials (cone rows, mix bar) beside a Recent movements timeline. Batch pages carry a lifecycle stepper and a tinted next-step field; Scan carries a four-step line; forms a two-step marker.

FORM: Cone Code, grounded candidate #2 of my list, chosen by the user from the safer re-roll. Signature move: the cone tip and material colour. Motion: nav pill glide, 0.97 press, scan answer rows arriving 60ms apart, the loom while analysing. seed:3cd5293ae89c9836

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
