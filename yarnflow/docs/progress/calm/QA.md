# Yarnflow UI verification

Final evidence contains **444 screenshots with zero automated failures or runtime errors**. The full 434-state round was followed by targeted recaptures for the link target, modal header and date-format corrections, plus saved/reopen and Urdu detail states. This report describes that assembled final evidence; it does not imply every screenshot was recreated after changes that do not affect its screen.

## Capture matrix

| Configuration | Captures |
|---|---:|
| 1440 | 80 |
| 1024 | 80 |
| 390 | 80 |
| 390-solid | 80 |
| 1440-dark | 78 |
| 390-urdu | 28 |
| 1440-states | 9 |
| 390-states | 9 |

The three requested widths are1440, 1024 and 390px. Reduced transparency is exercised at 390px; dark mode at 1440px; Urdu RTL at 390px. Supplemental states cover empty production, loading, connection failure, permission denial, stock matrix and day-close confirmation.

## Results

| Check | Result |
|---|---|
| axe WCAG 2A/AA, 2.1AA, 2.2AA |0 violations in 444 captures |
| Document horizontal overflow | 0 |
| Visible text below 14px | 0 |
| Measured controls below 48px | 0 |
| Type outside 14/16/18/20/24/32/40 or 400/500/600 | 0 |
| Violet hue or forbidden background gradient | 0 |
| Nested backdrop filters | 0 |
| Reduced-transparency captures | 80/80 report the media preference and zero backdrop filters |
| Disabled control opacity/contrast | All opacity 1; minimum calculated contrast 5.68:1 |
| Uncaught browser errors | 0 |

Actual disabled controls and visual disabled button states were checked against composited ancestor backgrounds. Native checkbox/radio boxes are excluded from direct size measurement because the wrapping label supplies their hit target. Final narrow link corrections were recaptured with anchors included in the target-size check.

Every capture was opened in contact sheets to verify render identity and broad layout. Detailed full-size inspection covered the desktop Today pages, phone fabric scanner, stock scroll instruction, order review, Urdu numbers/chart labels, saved/undo confirmation, reopen dialog, and final lot/report date formatting. Contact sheets support breadth; they do not substitute for those detailed checks.

## Workflow coverage and limits

The captures cover20 register routes, five real workspace routes, create/join setup, empty and populated stock, material/batch creation, receive/transfer/dispatch/waste/inspection/quality forms and review summaries, live reversal, all three scanner tabs, four reachable register entry kinds, order review, entry/reversal/lot/order/report dialogs, settings tabs, saved receipt/Undo and day reopening. Browser-local receipt Undo and reopening were performed only in disposable test contexts. Real fixtures use the separate in-memory server.

Four legacy modal branches (workspace/new/date/notifications) have no current opening trigger. Legacy waste/cops entry kinds likewise have no reachable opening trigger; they were not forced by modifying app state. The real workspace waste form and Cops stock stage remain available. These are pre-existing coverage limits, not feature removals by this pass.

The loading state pauses a real workspace request; the error state then fails its transport offline. No model predictions or API response data were fabricated. Physical camera behavior, trained-model inference, low-end-tablet scroll smoothness, screen-reader interaction with actual workers and real-user p75 performance were not established by these local Chromium captures.

## Files

- [Machine-readable audit](after/audit.json)
- [Baseline audit and63 before captures](BASELINE.md)
- [Harness and repeat commands](HARNESS.md)
- [Phone fabric scanner](after/live-scanner-fabric-390.png)
- [Phone stock](after/register-inventory-390.png)
- [Phone order review](after/register-order-review-390.png)
- [Phone saved receipt](after/register-receipt-saved-390.png)
- [Phone reopening](after/register-reopen-dialog-390.png)
- [Urdu lot detail](after/register-lot-detail-390-urdu.png)
