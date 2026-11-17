import { test, expect, type Page, type Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { origin, signIn, apiPost } from './helpers';
import { isQCResult, type QCResult } from '../src/qc-types';
import { REASON_TEXT, STATE_TEXT } from '../src/qc-reasons';
import { contentSha256, HASH_EXCLUDES } from '../server/qc-contract.mjs';
const fixtures = JSON.parse(readFileSync(new URL('../../scanner/tests/fixtures/qc-v2/valid.json', import.meta.url), 'utf8'));
const fixtureDouble = (name: string) => structuredClone(fixtures.find((f: any) => f.name === name).value);
const jpeg = readFileSync(new URL('../../scanner/tests/fixtures/qc-images/swatch.jpg', import.meta.url));
const jpegFile = { name: 'swatch.jpg', mimeType: 'image/jpeg', buffer: jpeg };
const captureFiles = [jpegFile, ...['swatch-exif6.jpg', 'phone-4032x3024.jpg'].map(name => ({ name, mimeType: 'image/jpeg', buffer: readFileSync(new URL('../../scanner/tests/fixtures/qc-images/' + name, import.meta.url)) }))];
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
async function qcPost(page: Page, path: string, data: object) {
 const response = await page.request.post('/api/qc/v2' + path, { data, headers: { Origin: origin, 'Idempotency-Key': crypto.randomUUID() } });
 expect(response.ok(), await response.text()).toBeTruthy(); return response.json();
}
async function getSample(page: Page, id: string): Promise<QCResult> {
 const response = await page.request.get('/api/qc/v2/samples/' + id);
 expect(response.ok(), await response.text()).toBeTruthy(); return response.json();
}
async function reviewOnly(page: Page) {
 await expect(page.locator('.qc-scope').getByText('A supervisor checks every result.', { exact: true })).toBeVisible();
 // The supervisor's own decision form offers Accept as a choice; machine output must never show ACCEPT.
 const accepted = await page.locator('.incoming-qc').evaluate(root => [...root.querySelectorAll('*')].filter(el => !el.closest('form.qc-adjudicate') && [...el.childNodes].some(node => node.nodeType === Node.TEXT_NODE && /\bACCEPT(?:ED)?\b/i.test(node.textContent ?? ''))).map(el => el.textContent));
 expect(accepted).toEqual([]);
}
// The wizard renders only the current step. Back/Next set a local override that a reload clears, so a reload returns to the Check step.
async function toPhotos(page: Page) { await page.getByRole('button', { name: /^(Back|واپس)$/ }).click(); await expect(page.locator('.qc-capture')).toBeVisible(); }
async function openSampleDetails(page: Page) {
 const details = page.locator('details.qc-inline-details').filter({ has: page.locator('.qc-sample-binding') });
 if (!(await details.evaluate(el => (el as HTMLDetailsElement).open))) await details.locator('summary').click();
 const binding = details.locator('.qc-sample-binding'); await expect(binding).toBeVisible(); return binding;
}
async function signOut(page: Page, name: string) {
 await page.goto('/#/profile');
 if (await page.locator('.live-bottom-nav').isVisible()) await page.getByRole('button', { name: 'More', exact: true }).click();
 // The app asks window.confirm before signing out; Playwright dismisses unhandled dialogs, which would keep the session.
 page.once('dialog', dialog => dialog.accept());
 await page.getByRole('button', { name: 'Sign out ' + name }).filter({ visible: true }).click();
 await expect(page.getByRole('heading', { name: 'Who are you?', exact: true })).toBeVisible();
}
async function confirmSpec(page: Page, orderId: string) {
 await page.getByLabel('Purchase order', { exact: true }).selectOption(orderId);
 await page.getByText('Confirm a specification version', { exact: true }).click();
 await page.getByLabel('Allowed fabric labels (comma separated)').fill('plain');
 await page.getByLabel('Taxonomy version').fill('browser-taxonomy-double');
 for (const axis of ['Ends (warp threads)', 'Picks (weft threads)']) {
  const fields = page.getByRole('group', { name: axis, exact: true });
  await fields.getByLabel('Target', { exact: true }).fill('80');
  await fields.getByLabel('Absolute lower limit').fill('70'); await fields.getByLabel('Absolute upper limit').fill('90');
 }
 await page.getByLabel('Confirmation reason').fill('Requirements double for browser proof');
 const confirmed = page.waitForResponse(r => r.url().endsWith('/api/qc/v2/specs') && r.request().method() === 'POST');
 await page.getByRole('button', { name: 'Confirm immutable specification' }).click();
 const response = await confirmed; expect(response.status()).toBe(201); const spec = await response.json();
 await expect(page.locator('.qc-order-facts')).toContainText('70–90 count/in'); await reviewOnly(page);
}
// Public procurement APIs create an actual PO in the isolated SQLite test database.
async function prepareSample(page: Page) {
 await signIn(page, 'Anas');
 await apiPost(page, '/portal/register', { company: 'QC supplier double', contactName: 'Supplier double', email: 'qc-double@factory.test', phone: '+923001234567', categories: ['cotton'], password: 'QC supplier double password 2026' });
 const suppliers = await (await page.request.get('/api/erp/suppliers?status=pending')).json();
 await apiPost(page, '/erp/suppliers/review', { id: suppliers.suppliers[0].id, version: 1, status: 'approved', reason: 'Supplier double for browser test', interventionReason: 'Isolated browser test setup' });
 const { rfq } = await apiPost<any>(page, '/erp/rfqs', { id: crypto.randomUUID(), title: 'QC browser test order', categoryId: 'cotton', specifications: 'Woven swatch for isolated browser proof', quantityMilli: 1000, unit: 'kg', deliveryLocation: 'Browser test location', deadlineAt: Date.now() + 86400000, requestedDeliveryAt: Date.now() + 7 * 86400000, interventionReason: 'Isolated browser test setup' });
 await apiPost(page, '/erp/rfqs/publish', { id: rfq.id, interventionReason: 'Isolated browser test setup' });
 await apiPost(page, '/portal/login', { email: 'qc-double@factory.test', password: 'QC supplier double password 2026' });
 const bid = await apiPost<any>(page, '/portal/bids', { id: crypto.randomUUID(), rfqId: rfq.id, version: 0, quantityMilli: 1000, priceMinor: 100, currency: 'PKR', paymentTerms: 'Browser test terms', deliveryAt: Date.now() + 7 * 86400000, validUntil: Date.now() + 3 * 86400000, note: '' });
 const { order } = await apiPost<any>(page, '/erp/bids/award', { id: bid.bid?.id ?? bid.id, version: 1, interventionReason: 'Isolated browser test setup' });
 // Authority double tests access enforcement only; it is not a legal or release approval.
 const consentDouble = await qcPost(page, '/consent-authorities', { authority_evidence_sha256: sha('browser consent authority double'), operational_capture: true, operational_retention_days: 1, research_use: false, training_use: false, export_destinations: [], valid_from: new Date(Date.now() - 60000).toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString() });
 await signOut(page, 'Anas'); await signIn(page, 'Pervaiz'); await page.goto('/#/incoming-qc');
 await reviewOnly(page); await confirmSpec(page, order.id);
 await signOut(page, 'Pervaiz'); await signIn(page, 'Qasim'); await page.goto('/#/incoming-qc');
 await page.getByLabel('Purchase order', { exact: true }).selectOption(order.id);
 await expect(page.locator('.qc-order-facts')).toContainText('70–90 count/in'); await page.getByRole('button', { name: 'Next', exact: true }).click();
 for (const [label, value] of [['Lot reference','QC-LOT-01'],['Roll reference','QC-ROLL-01'],['Location on roll','QC-LOCATION-01'],['Plan version','browser-plan-double']]) await page.getByLabel(label, { exact: true }).fill(value);
 await page.getByRole('button', { name: 'Next', exact: true }).click();
 for (const [label, value] of [['Group code','browser-group-double'],['Sampling method','Operational browser test selection'],['Planned area (cm²)','25']]) await page.getByLabel(label, { exact: true }).fill(value);
 await page.getByLabel('Face', { exact: true }).selectOption('face');
 const created = page.waitForResponse(r => r.url().endsWith('/api/qc/v2/samples') && r.request().method() === 'POST');
 await page.getByRole('button', { name: 'Start sample', exact: true }).click();
 const response = await created; expect(response.status()).toBe(201); const result: QCResult = await response.json();
 const binding = await openSampleDetails(page); await expect(binding).toContainText(result.sample.id); await reviewOnly(page);
 return { result, consentDouble, order };
}
async function tabTo(page: Page, target: Locator) {
 for (let i = 0; i < 100; i++) {
  if (await target.evaluate(el => el === document.activeElement)) return;
  await page.keyboard.press('Tab');
 }
 throw new Error('Keyboard could not reach ' + await target.getAttribute('aria-label'));
}
async function uploadAndClose(page: Page, consentId: string, keyboard = false) {
 await page.getByLabel('Camera name').fill('browser-unvalidated-double'); await page.getByLabel('Consent authority', { exact: true }).selectOption(consentId);
 for (const [i, role] of ['Overview photo', 'Close-up of the weave', 'Photo with the scale card'].entries()) {
  const input = page.getByLabel('Choose original: ' + role, { exact: true });
  if (keyboard) { await tabTo(page, input); const chooser = page.waitForEvent('filechooser'); await page.keyboard.press('Enter'); await (await chooser).setFiles(captureFiles[i]); }
  else await input.setInputFiles(captureFiles[i]);
  await expect(page.getByRole('img', { name: role + ' — draft preview', exact: true })).toBeVisible(); await reviewOnly(page);
 }
 const uploaded = page.waitForResponse(r => r.url().endsWith('/captures') && r.request().method() === 'POST');
 const upload = page.getByRole('button', { name: 'Upload originals', exact: true });
 await expect(upload).toBeEnabled();
 if (keyboard) { await tabTo(page, upload); await page.keyboard.press('Enter'); } else await upload.click();
 expect((await uploaded).status()).toBe(201);
 await expect(page.getByText('Uploading originals…', { exact: true })).toHaveCount(0);
 const close = page.getByRole('button', { name: 'Close capture set', exact: true });
 const closed = page.waitForResponse(r => r.url().endsWith('/close'));
 if (keyboard) { await tabTo(page, close); await page.keyboard.press('Enter'); } else await close.click();
 const response = await closed; expect(response.status()).toBe(200); const result: QCResult = await response.json();
 await toPhotos(page); await openSampleDetails(page); await expect(page.getByRole('heading', { name: /^Saved photo set · Closed/ })).toHaveCount(result.capture_sets.length); await page.reload();
 await reviewOnly(page); return result;
}
async function seriousViolations(page: Page) {
 return (await new AxeBuilder({ page }).include('.incoming-qc').analyze()).violations.filter(v => ['serious','critical'].includes(v.impact ?? ''));
}

test.describe('real incoming QC workflow', () => {
 test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });
 test.beforeEach(async ({ page }) => { expect((await page.request.post('/__test/reset')).ok()).toBeTruthy(); });
 test('keyboard capture, unavailable scanner, server reload, supervisor review, read-only Urdu and sign-out', async ({ page }) => {
  test.setTimeout(60000);
  const { result, consentDouble } = await prepareSample(page);
  const closed = await uploadAndClose(page, consentDouble.id, true);
  expect(closed.captures).toHaveLength(3); expect(closed.capture_sets.at(-1)?.state).toBe('CLOSED');
  expect(Object.fromEntries(closed.captures.map(c => [c.role, c.original_sha256]))).toEqual(Object.fromEntries(['overview','structure','scale'].map((role, i) => [role, sha(captureFiles[i].buffer)])));
  expect(closed.captures.find(c => c.role === 'scale')).toMatchObject({ width: 4032, height: 3024, byte_size: captureFiles[2].buffer.length });
  const analyses: number[] = []; page.on('response', r => { if (r.url().endsWith('/analyze')) analyses.push(r.status()); });
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/Nothing was decided.*try again later/i, { timeout: 15000 });
  expect(analyses.length).toBeGreaterThan(0); expect(analyses.every(s => s === 503)).toBe(true);
  await expect(page.getByRole('status').filter({ hasText: 'Scanner not connected' })).toBeVisible();
  await expect(page.getByTestId('qc-result')).toHaveCount(0); await reviewOnly(page);
  expect(await seriousViolations(page)).toEqual([]);
  await page.reload();
  await toPhotos(page);
  const binding = await openSampleDetails(page); await expect(binding).toContainText(result.sample.id);
  const restored = await getSample(page, result.sample.id);
  expect(restored.captures).toEqual(closed.captures); expect(restored.capture_sets).toEqual(closed.capture_sets); expect(restored.decision).toBeNull(); expect(restored.history).toEqual([]);
  await expect(page.getByRole('img', { name: /saved original/i })).toHaveCount(3);
  await expect.poll(() => page.getByRole('img', { name: /saved original/i }).evaluateAll(images => images.every(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await expect(page.getByRole('heading', { name: /^Saved photo set · Closed/ }).first()).toBeVisible(); await reviewOnly(page);
  await signOut(page, 'Qasim'); await expect(page.getByTestId('qc-result')).toHaveCount(0); await expect(page.locator('.incoming-qc img')).toHaveCount(0);
  await signIn(page, 'Saima'); await page.goto(`/#/incoming-qc/${result.sample.id}`);
  await page.getByLabel('Review reason', { exact: true }).fill('Scanner unavailable; physical review remains undetermined');
  await page.getByLabel('Reference IDs (comma separated)').fill('browser-review-double');
  await page.getByRole('button', { name: 'Save decision', exact: true }).click();
  await expect(page.locator('.qc-adjudication')).toContainText('Scanner unavailable; physical review remains undetermined'); await reviewOnly(page);
  const reviewed = await getSample(page, result.sample.id); expect(reviewed.adjudications).toHaveLength(1); expect(reviewed.decision).toBeNull();
  await signOut(page, 'Saima'); await signIn(page, 'Sana'); await page.goto(`/#/incoming-qc/${result.sample.id}`);
  await expect(page.getByText('Read-only view', { exact: true })).toBeVisible();
  for (const name of ['Upload originals','Close capture set','Analyze','Save decision','Confirm immutable specification','Start sample']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  await reviewOnly(page); await page.goto('/#/app-settings'); await page.getByRole('radio', { name: 'اردو', exact: true }).check(); await page.goto(`/#/incoming-qc/${result.sample.id}`);
  await expect(page.locator('.incoming-qc')).toHaveAttribute('dir','rtl');
  await toPhotos(page); await openSampleDetails(page);
  await expect(page.locator('.qc-sample-binding bdi[dir="ltr"]').filter({ hasText: result.sample.id })).toBeVisible();
  await expect(page.locator('.qc-technical-details bdi[dir="ltr"]').first()).toBeVisible();
  expect(await page.locator('.incoming-qc bdi[dir="ltr"]').count()).toBeGreaterThan(5);
 });
 test('fixture decision double uses real bindings, renders reasons/stages/icon, and ignores a late previous-sample response', async ({ page }) => {
  const { result, consentDouble } = await prepareSample(page);
  await uploadAndClose(page, consentDouble.id);
  const templateDouble = fixtureDouble('result-decided-with-adjudications');
  const real = await getSample(page, result.sample.id);
  const evidenceDouble = { ...templateDouble.evidence, sample_id: real.sample.id, capture_ids: real.captures.map(c => c.id), spec_sha256: (await (await page.request.get(`/api/qc/v2/specs/${real.sample.spec_id}?version=1`)).json()).spec.content_sha256 };
  // Synthetic fixture stages are rendering doubles, never claimed as scanner output.
  const syntheticEvidenceDouble = fixtureDouble('evidence-synthetic-all-stages-ok');
  const captureMapDouble = new Map(templateDouble.evidence.capture_ids.map((id: string, i: number) => [id, real.captures[i]]));
  evidenceDouble.defects = syntheticEvidenceDouble.defects; evidenceDouble.metrology = syntheticEvidenceDouble.metrology;
  for (const view of evidenceDouble.defects.value.views) { const capture = captureMapDouble.get(view.capture_id) as QCResult['captures'][number]; view.capture_id = capture.id; view.capture_sha256 = capture.original_sha256; }
  for (const region of evidenceDouble.defects.value.regions) region.capture_id = (captureMapDouble.get(region.capture_id) as QCResult['captures'][number]).id;
  for (const measurement of evidenceDouble.metrology.value) { const capture = captureMapDouble.get(measurement.capture_id) as QCResult['captures'][number]; measurement.capture_id = capture.id; measurement.capture_sha256 = capture.original_sha256; }
  evidenceDouble.manifest_sha256 = await contentSha256(evidenceDouble, HASH_EXCLUDES.Evidence);
  const decisionDouble = { ...templateDouble.decision, sample_id: real.sample.id, spec_id: real.sample.spec_id, spec_version: real.sample.spec_version, evidence_id: evidenceDouble.id };
  const resultDouble: QCResult = { ...real, sample: { ...real.sample, revision: decisionDouble.revision }, revision: decisionDouble.revision, evidence: evidenceDouble, decision: decisionDouble, history: [decisionDouble] };
  expect(isQCResult(resultDouble)).toBe(true);
  let defer = false, release!: () => void, entered!: () => void, delivered!: () => void;
  const pending = new Promise<void>(resolve => entered = resolve), done = new Promise<void>(resolve => release = resolve), completed = new Promise<void>(resolve => delivered = resolve);
  await page.route(`**/api/qc/v2/samples/${real.sample.id}`, async route => { if (defer) { entered(); await done; } await route.fulfill({ json: resultDouble, headers: { 'Cache-Control': 'no-store' } }); if (defer) delivered(); });
  try {
   await page.getByRole('button', { name: 'Reload sample', exact: true }).click();
   const heading = page.getByTestId('qc-result').getByRole('heading', { level: 2 });
   await expect(heading).toBeFocused(); await expect(page.getByTestId('qc-result').locator('.ui-status')).toContainText('Needs manual review'); await expect(page.getByTestId('qc-result').locator('.ui-status svg')).toHaveAttribute('aria-hidden','true'); await page.locator('details.qc-result-details > summary').click();
   for (const reason of decisionDouble.reasons) await expect(page.getByTestId('qc-result')).toContainText(REASON_TEXT[reason].text[0]); // operators read the sentence, not the code
   for (const stage of ['Photo quality','Fabric type','Defect check','Thread count','Validated conditions']) await expect(page.getByTestId('qc-stages')).toContainText(stage);
   for (const stage of ['quality','fabric','defects','metrology','domain']) await expect(page.getByTestId('qc-stages')).toContainText(STATE_TEXT[evidenceDouble[stage].state as keyof typeof STATE_TEXT][0]);
   const regions = page.getByTestId('qc-result').locator('.qc-region-list'); await expect(regions).toHaveCount(2);
   for (let i = 0; i < 2; i++) { await expect(regions.nth(i).getByRole('heading')).toContainText(real.captures[i].id); await expect(regions.nth(i).getByRole('listitem')).toHaveCount(1); await expect(regions.nth(i).getByRole('listitem')).toContainText('0.1, 0.1, 0.2, 0.2'); }
   const measurements = page.getByTestId('qc-result').locator('.qc-measurement'); await expect(measurements).toHaveCount(2);
   for (let i = 0; i < 2; i++) { const m = evidenceDouble.metrology.value[i]; await expect(measurements.nth(i)).toContainText(`${m.interval95[0]}–${m.interval95[1]} count/in`); await expect(measurements.nth(i)).toContainText(m.reference_id); await expect(measurements.nth(i)).toContainText('70 / 90 count/in'); }
   await expect(page.getByTestId('qc-fabric')).toContainText('unknown'); await reviewOnly(page); expect(await seriousViolations(page)).toEqual([]);
   const selection = await qcPost(page, '/selections', { purchase_order_id: real.sample.purchase_order_id, plan_version: 'browser-plan-double', plan_sha256: null, randomization_seed: null, draw_index: null, selection_probability: null, cohort: 'OPERATIONAL', independent_group_id: 'second-browser-group-double', lot_ref: real.sample.lot_ref, roll_ref: real.sample.roll_ref, location_ref: 'QC-LOCATION-02', face: 'face', planned_area_cm2: 25, method: 'Second operational browser selection' });
   const next = await qcPost(page, '/samples', { selection_id: selection.id, spec_id: real.sample.spec_id, spec_version: 1, predecessor_sample_id: null, expected_predecessor_revision: null, reason: 'Second sample for stale response proof' });
   defer = true; await page.getByRole('button', { name: 'Reload sample', exact: true }).click(); await pending;
   await page.goto(`/#/incoming-qc/${next.sample.id}`); const binding = await openSampleDetails(page); await expect(binding).toContainText(next.sample.id);
   release(); await completed; await expect(page.getByTestId('qc-result')).toHaveCount(0); await expect(binding).toContainText(next.sample.id);
   await expect(binding).not.toContainText(real.sample.id); await reviewOnly(page);
   await signOut(page, 'Qasim'); await expect(page.getByTestId('qc-result')).toHaveCount(0);
  } finally { release?.(); }
 });
 test('revised specification creates an immutable linked sample, recaptures and preserves the three-attempt budget', async ({ page }) => {
  const { result, consentDouble, order } = await prepareSample(page);
  const first = await uploadAndClose(page, consentDouble.id);
  await signOut(page, 'Qasim'); await signIn(page, 'Pervaiz'); await page.goto('/#/incoming-qc'); await confirmSpec(page, order.id);
  await signOut(page, 'Pervaiz'); await signIn(page, 'Qasim'); await page.goto(`/#/incoming-qc/${result.sample.id}`);
  await expect(page.getByText('Requirements changed', { exact: true })).toBeVisible();
  await expect(page.getByText(/New photographs are required/)).toBeVisible(); await expect(page.getByRole('button', { name: 'Analyze', exact: true })).toBeDisabled();
  await page.getByLabel('Linked evaluation reason').fill('Recapture under the revised specification double');
  const created = page.waitForResponse(r => r.url().endsWith('/api/qc/v2/samples') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Start linked evaluation under the current specification' }).click();
  const linked: QCResult = await (await created).json(); expect(linked.sample.spec_version).toBe(2); expect(linked.sample.id).not.toBe(first.sample.id);
  expect(linked.family.selection_id).toBe(first.family.selection_id); expect(linked.family.attempts_used).toBe(1); expect(linked.captures).toEqual([]); expect(linked.capture_sets).toEqual([]);
  await expect(page).toHaveURL(new RegExp('/incoming-qc/' + linked.sample.id + '$'));
  await expect(page.getByRole('img', { name: /draft preview|saved original/ })).toHaveCount(0); await expect(page.getByTestId('qc-result')).toHaveCount(0);
  await uploadAndClose(page, consentDouble.id); await toPhotos(page); const third = await uploadAndClose(page, consentDouble.id);
  expect(third.family.attempts_used).toBe(3); await toPhotos(page); await expect(page.getByText(/Ask a supervisor to inspect this sample/)).toBeVisible();
  await expect(page.getByLabel('Choose original: Overview photo', { exact: true })).toBeDisabled(); await reviewOnly(page);
  const original = await getSample(page, first.sample.id); expect(original.sample.spec_version).toBe(1); expect(original.captures).toEqual(first.captures); expect(original.history).toEqual([]); expect(original.family.successor_sample_ids).toContain(linked.sample.id);
  await page.reload(); await toPhotos(page); await expect(page.getByText(/Ask a supervisor to inspect this sample/)).toBeVisible();
 });
 test('memory-only drafts revoke replaced and expired previews without persisting QC metadata', async ({ page }) => {
  const { result } = await prepareSample(page); await page.clock.install();
  const input = page.getByLabel('Choose original: Overview photo', { exact: true });
  await input.setInputFiles(jpegFile); const preview = page.getByRole('img', { name: 'Overview photo — draft preview', exact: true }); await expect(preview).toBeVisible();
  const firstURL = await preview.getAttribute('src'); await input.setInputFiles(jpegFile);
  await expect(preview).not.toHaveAttribute('src', firstURL!);
  const recoverable = (url: string) => page.evaluate(async value => { try { return (await fetch(value)).ok; } catch { return false; } }, url);
  expect(await recoverable(firstURL!)).toBe(false); const currentURL = await preview.getAttribute('src');
  const persisted = await page.evaluate(async () => ({ local: JSON.stringify(localStorage), session: JSON.stringify(sessionStorage), databases: await indexedDB.databases(), caches: await caches.keys() }));
  for (const sensitive of [result.sample.id, result.sample.lot_ref, sha(jpeg), currentURL!]) { expect(persisted.local).not.toContain(sensitive); expect(persisted.session).not.toContain(sensitive); }
  expect(persisted.databases).toEqual([]); expect(persisted.caches).toEqual([]);
  await expect(page.getByText(/Reloading loses them/)).toBeVisible(); await page.clock.fastForward(24 * 60 * 60 * 1000);
  await expect(preview).toHaveCount(0); expect(await recoverable(currentURL!)).toBe(false);
  await expect(page.getByRole('button', { name: 'Upload originals', exact: true })).toBeDisabled(); await expect(page.getByTestId('qc-result')).toHaveCount(0); await reviewOnly(page);
 });
 test('offline sign-out keeps the sign-in screen after reload and never restores the previous workspace', async ({ page, context }) => {
  const { result } = await prepareSample(page);
  await context.setOffline(true);
  await signOut(page, 'Qasim');
  await expect(page.getByRole('heading', { name: 'Who are you?', exact: true })).toBeVisible();
  // The sign-out never reached the server, so the durable marker must survive for the next start.
  const markerBeforeReload = await page.evaluate(() => localStorage.getItem('yarnflow.pendingSignOut'));
  await context.setOffline(false);
  await page.reload();
  // The reload must finish the sign-out instead of asking the server who is still signed in.
  await expect(page.getByRole('heading', { name: 'Who are you?', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toHaveCount(0);
  await expect(page.getByText(result.sample.id, { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('qc-result')).toHaveCount(0);
  expect(markerBeforeReload).toBe('1');
  expect(await page.evaluate(() => localStorage.getItem('yarnflow.pendingSignOut'))).toBeNull();
 });
 test('two tabs offline sign-out purges original previews and sends no old uploads on a new login', async ({ page, context }) => {
  const { result } = await prepareSample(page);
  await page.getByLabel('Choose original: Overview photo', { exact: true }).setInputFiles(jpegFile);
  await expect(page.getByRole('img', { name: 'Overview photo — draft preview', exact: true })).toBeVisible();
  const second = await context.newPage(); await second.goto(`/#/incoming-qc/${result.sample.id}`);
  await second.getByLabel('Choose original: Overview photo', { exact: true }).setInputFiles(jpegFile);
  await expect(second.getByRole('img', { name: 'Overview photo — draft preview', exact: true })).toBeVisible();
  let uploads = 0; context.on('request', r => { if (r.method() === 'POST' && r.url().endsWith('/captures')) uploads++; });
  await context.setOffline(true); await signOut(page, 'Qasim');
  await expect(second.getByRole('heading', { name: 'Who are you?', exact: true })).toBeVisible(); await expect(second.locator('.incoming-qc img')).toHaveCount(0);
  await context.setOffline(false); await page.getByRole('button', { name: 'Retry', exact: true }).click(); await page.getByRole('button', { name: /^Sana\b/ }).click(); await page.getByLabel('4-digit PIN', { exact: true }).fill('2468'); await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible(); await page.goto(`/#/incoming-qc/${result.sample.id}`);
  await expect(page.getByText('Read-only view', { exact: true })).toBeVisible(); await expect(page.locator('.incoming-qc img')).toHaveCount(0); expect(uploads).toBe(0);
 });
});

test.describe('production service worker', () => {
 test.use({ serviceWorkers: 'allow', reducedMotion: 'reduce' });
 test('built worker controls the page, purges obsolete shell caches and never caches real private originals', async ({ page, context }) => {
 test.setTimeout(60000);
 await page.request.post('/__test/reset');
 // The dev server forces no-store on all static files. Serve public files through the actual
 // built production handler; every /api and /__test request still reaches real SQLite routes.
 const production = (await import('../dist/server/index.js')).default;
 await context.route(url => !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/__test/'), async route => {
  const response = await production.fetch(new Request(route.request().url()), {});
  await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
 });
 // Register before navigating so the app load event cannot race registration; only production sw.js is used.
 await page.goto('/icon.svg');
 await page.evaluate(async () => { await caches.open('yarnflow-obsolete-double'); await navigator.serviceWorker.register('/sw.js'); });
 await expect.poll(() => page.evaluate(async () => ({ controller: !!navigator.serviceWorker.controller, state: (await navigator.serviceWorker.getRegistration())?.active?.state }))).toEqual({ controller: true, state: 'activated' });
 const { result, consentDouble } = await prepareSample(page); const closed = await uploadAndClose(page, consentDouble.id);
 const privatePath = `/api/qc/v2/captures/${closed.captures.find(c => c.role === 'overview')!.id}/original`;
 const read = await page.request.get(privatePath); expect(read.ok()).toBe(true); expect(read.headers()['cache-control']).toBe('private,no-store'); expect(await read.body()).toEqual(jpeg);
 await page.evaluate(path => new Promise<void>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(); image.onerror = () => reject(new Error('Real private original did not decode')); image.src = path; }), privatePath);
 const keys = await page.evaluate(async () => ({ names: await caches.keys(), urls: (await Promise.all((await caches.keys()).map(async name => (await (await caches.open(name)).keys()).map(r => r.url)))).flat() }));
 expect(keys.names).not.toContain('yarnflow-obsolete-double'); expect(keys.urls.some(url => new URL(url).pathname.startsWith('/api/'))).toBe(false); expect(keys.urls.some(url => new URL(url).pathname === '/')).toBe(true);
 await signOut(page, 'Qasim'); expect((await page.request.get(privatePath)).status()).toBe(401);
 await context.setOffline(true);
 expect(await page.evaluate(async path => { try { return (await fetch(path)).ok; } catch { return false; } }, privatePath)).toBe(false);
 await page.goto('/'); await expect(page.getByRole('heading', { name: 'Who are you?', exact: true })).toBeVisible(); await expect(page.locator('.incoming-qc img')).toHaveCount(0);
 await context.setOffline(false); expect(result.decision).toBeNull();
});

});
