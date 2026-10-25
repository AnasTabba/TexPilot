# Register interface visual update

The working register interface remains separate from the real shared inventory app. No sample records were imported, and stock calculations, validation, draft storage, review, saving, reversals, CSV exports and permission boundaries are retained.

| Screen | Changes |
| --- | --- |
| Today | Attention remains first. Alerts use plain rows with a status icon and words. Totals share one neutral surface without icon tiles or trend arrows. Machine and daily production retain flat teal data marks and direct values. |
| Production | Clear heading, one primary Record action, quiet summary and readable register rows. |
| Stock | Aligned stock totals, neutral material rows, readable stage tabs and no decorative material colours. |
| Orders | Normal-font order numbers, readable due dates, restrained progress marks and one primary Record action. |
| Dispatch | Same register and movement component vocabulary as Production; QC status remains explicit. |
| Registers | Solid table surface, plain headers, tabular figures, human-readable dates and contained table scrolling. |
| More | Simple action rows with recognisable icons and labels instead of a grid of tinted cards. |
| Reports | Neutral report surfaces, single icon family and plain descriptions. Existing export and print behaviour preserved. |
| Settings, masters and people | Consistent controls, visible selection, solid surfaces and legible text. Read-only previews remain labelled. |
| Help, search, day close and save status | Clear task wording, quiet dividers and explicit empty, error and saved states. |
| Forms and details | Opaque forms inside floating dialog chrome. Large labelled inputs, original inline validation, review summary and undo/reversal flows retained. Dates formatted only for display; date input and stored values stay ISO. |
| Sign in | Solid white form, legible PIN controls, no artwork or frosted content. |

## Shared implementation

- Reads colour, type and material tokens from `src/theme.css`, shared with the real app.
- The installed IBM Plex Sans family uses 400, 500 and 600 weights, with Urdu preserved in its existing font.
- Uses the requested type steps, 48px controls, visible focus and logical CSS properties for Urdu.
- Glass is assigned only to `.sidebar`, `.topbar`, `.bottom-tabs`, `.modal` and `.tabs`; shared theme rules own supported-browser and reduced-transparency behaviour.
- Removed obsolete original dashboard, sparkline and artwork selectors; removed redundant earlier declarations. Removed the `glass` class from content containers.
- The practice banner's real-workspace action now opens the actual app at `/`, instead of an obsolete explanation that a real workspace did not exist.

## Verification and limits

The TypeScript check passed during implementation; the parent build verifies scanner copy changes together with the live app. The automated screen matrix and accessibility results are recorded by the QA pass in `docs/progress/calm/`.

No mill-staff research was conducted. Readability and task choices follow the supplied audience brief; real users and factory hardware should validate these assumptions. The register interface is still browser-local practice data: this work does not turn it into the shared ledger.

## Finish-review corrections

- Added a real bilingual scroll instruction before every overflowing register table, including report previews. It appears only when columns are offscreen, and is connected to the focusable scroll region with `aria-describedby`. Width and content changes update the cue through `ResizeObserver`.
- Removed the redundant Reports eyebrow. Sentence-cased the remaining decorative uppercase copy while retaining technical acronyms.
- Isolated Latin yarn specifications using `<bdi dir="ltr">` in Today, register rows, Stock, search, masters, forms and details. This preserves fraction order alongside Urdu text without changing stored specification values.
- Removed unused `.glass` CSS rules after verifying that no legacy JSX referenced the class.
