# Yarnflow visual design revision

The visual reference is the supplied original Overview. The prior redesign's wording, text sizes, navigation structure, entry workflow, and task order are retained.

## Shared design

`src/workspace.css` now defines canonical product tokens and aliases for the existing components:

- Brand violet `#6B4FD8`, hover `#5A3FC0`, light `#F3F0FD`, mid `#E4DCFA`.
- Page `#F6F6F9`, card `#FFFFFF`, border `#E8E7EF`.
- Primary text `#1C1B22`, secondary text `#55536A`. A separate stronger input-border token preserves control visibility.
- Green `#17784B` on `#E7F5EE`, amber `#925000` on `#FFF3DF`, red `#B42B24` on `#FDEBEA`. Amber is slightly darker than the proposed shade. Status always includes words and an icon where appropriate.
- 16 px card corners, 24 px card padding, soft shared shadows; 12 px buttons and 10 px inputs. Small-screen table/form containers use 16 px horizontal padding to preserve room for the existing text sizes.
- Headings/key figures use weight 600, buttons/navigation 500, and body text 400. Current font sizes remain intact.
- Only hover/press transitions run, for 150 ms. Reduced-motion preferences disable these too. Theme and enable/disable changes do not animate.

The logo mark is restored next to the wordmark. Current navigation uses a violet tint and violet text/icon. Practice labels use amber surfaces. All routes, settings tabs, forms and detail dialogs share these surfaces and controls.

## Today

Attention items have individual cards, urgency borders, matching status icons, violet actions and friendly dates. Today's four totals have white cards and recognisable icons: four columns on desktop, two on tablet and one on phones. Finished stock reports the carton count instead of the previous instruction.

Machine bars use violet fills, light violet tracks and dark target markers. A single target key explains the markers. Each value has a green or amber status pill alongside it, including on phones.

Weekly bars use a violet fill for today and a mid tint for earlier recorded days, rounded tops, and a labelled dashed target. Zero-value labels are removed. The zero-based axis and accessible daily-figure table remain.

## Historical-data finding

The original `ProductionChart` hard-coded the first six daily values as `[2180, 2510, 2250, 3180, 2820, 3100]`. They were not queried from production records. `seedEntries()` contains opening balances and today's entries only. The redesign did not remove dated historical ledger entries.

The chart continues to aggregate actual dated production records, excluding opening balances and reversed records. Missing days remain blank with an explanation. No historical stock was invented to recreate the original curve. A browser test injects a dated fixture in an isolated context, verifies its appearance on the correct day, reverses it, and verifies removal. The fixture is not included in the application or seed data.

This is the intentional visual difference from the original reference: a populated week requires real historical entries (or an explicitly supplied historical practice fixture).

## Verification and screenshots

`node .qa/polish-check.mjs` captures and audits 20 routes at 1440, 1024 and 390 px, plus 22 form/detail/settings states at each of those widths, Urdu routes at 390 px and dark routes at 1440 px: 166 combinations. The final run passed all 166 combinations, with no detected axe WCAG 2.2 AA violations, page overflow, text below 14 px in the checked content, or JavaScript page errors. Raw results are in [polish/audit.json](polish/audit.json). All screenshots are retained beside the audit.

The existing ledger/scanner tests (`npm test`), production build (`npm run build`), and entry workflow checks (`node .qa/redesign-workflow.mjs`) are also rerun. Weekly chart verification is in [polish/history-check.json](polish/history-check.json).

| Screen | Desktop 1440 | Tablet 1024 | Phone 390 |
| --- | --- | --- | --- |
| Today | [Screenshot](polish/overview-en-light-1440.png) | [Screenshot](polish/overview-en-light-1024.png) | [Screenshot](polish/overview-en-light-390.png) |
| Production | [Screenshot](polish/production-en-light-1440.png) | [Screenshot](polish/production-en-light-1024.png) | [Screenshot](polish/production-en-light-390.png) |
| Stock | [Screenshot](polish/inventory-en-light-1440.png) | [Screenshot](polish/inventory-en-light-1024.png) | [Screenshot](polish/inventory-en-light-390.png) |
| Orders | [Screenshot](polish/orders-en-light-1440.png) | [Screenshot](polish/orders-en-light-1024.png) | [Screenshot](polish/orders-en-light-390.png) |
| Dispatch | [Screenshot](polish/dispatch-en-light-1440.png) | [Screenshot](polish/dispatch-en-light-1024.png) | [Screenshot](polish/dispatch-en-light-390.png) |
| Registers | [Screenshot](polish/register-en-light-1440.png) | [Screenshot](polish/register-en-light-1024.png) | [Screenshot](polish/register-en-light-390.png) |
| More | [Screenshot](polish/more-en-light-1440.png) | [Screenshot](polish/more-en-light-1024.png) | [Screenshot](polish/more-en-light-390.png) |
| Entry review | [Screenshot](polish/production-review-en-light-1440.png) | [Screenshot](polish/production-review-en-light-1024.png) | [Screenshot](polish/production-review-en-light-390.png) |

[Original visual reference](polish/original-reference.png) · [Previous grey Overview](redesign/overview-en-1440.png)
