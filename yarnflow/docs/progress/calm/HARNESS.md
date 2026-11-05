# Screenshot and accessibility harness

Run from `yarn-erp` after building the desired version:

```sh
YARNFLOW_LOCAL_DEV=1 YARNFLOW_TEST_MODE=1 YARNFLOW_SQLITE_PATH=:memory: PORT=8792 node scripts/dev-server.mjs
node .qa/calm-check.mjs --before
node .qa/calm-check.mjs
node .qa/calm-check.mjs --dialogs
node .qa/calm-check.mjs --dates
```

The script refuses no screenshots silently: per-state failures appear in `audit.json.errors`, and every captured file has a result row. All live fixtures use the isolated in-memory server. New identities per invocation prevent reuse of prior fixtures; no product or stock is added to the user's default preview database. Forms are opened and filled for review without saving their drafts to live stock.

The before set has63 captures at1440px. The after set targets1440,1024,390,390with reduced transparency,1440dark and390Urdu. The English configurations cover routes, forms, review steps and details; Urdu covers all20 register routes, while the real workspace remains English as implemented.

Checks include axe WCAG2A/AA,2.1AA and2.2AA rules, document horizontal overflow, visible text smaller than14px, noncheckbox controls smaller than48px, IBM Plex font, allowed type scale/weights, violet hue detection, forbidden background gradients and a record of every active backdrop filter. Native checkbox sizes are excluded because their wrapping label is the intended48px hit region. Icons do not count as text.

Review: role/label locators are used for interaction, `document.fonts.ready` gates images, every route waits for a semantic heading, and there are no arbitrary timeout sleeps. The CSS locator used for the live sidebar only signals completed app loading; computed-style DOM inspection is necessary for the requested pixel measurements. Server fixture writes use the real API and stock constraints. External model results are never fabricated.

Measurements are local Chromium lab observations. They do not prove physical iPhone camera behavior, real-user p75 Core Web Vitals, comprehension by mill staff, or low-end-tablet scrolling. Review actual captures and retain these limits in the final report.

The final evidence contains 444 rows after the full matrix plus finite dialog/date captures. `--links` refreshes only welcome, workspace settings and yarn-spec card links after a narrow target-size change. `--dialogs` refreshes saved receipt, reopening and three existing mobile modal headers. `--dates` refreshes lot/report details in all six configurations. These modes preserve unrelated audit rows and upsert matching screenshots.

Screenshots are captured from the document top before axe runs. This avoids focus-test side effects entering images. A focused skip link is blurred; form-field focus is retained. Review captures assert the actual review heading, and required dates are explicitly filled in disposable register drafts. The final lot/report captures assert no ISO date appears in their rendered dialog text.
