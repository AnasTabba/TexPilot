import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { signIn } from './helpers';
// All fabricated server evidence here is a test double, never shipped in the app.
const fixtures = JSON.parse(readFileSync(new URL('../../scanner/tests/fixtures/qc-v2/valid.json', import.meta.url), 'utf8'));
const fixtureDouble = (name: string) => structuredClone(fixtures.find((f: any) => f.name === name).value);
const resultDouble = () => fixtureDouble('result-decided-with-adjudications');
async function apiDouble(page: Page, result = resultDouble(), role = 'quality_inspector') {
 const specDouble = fixtureDouble('spec-woven-v1');
 await page.route('**/api/qc/v2/**', async route => {
  const url = new URL(route.request().url()), path = url.pathname.replace('/api/qc/v2','');
  const value = path === '/status' ? { schema_version: '2', mode: 'REVIEW_ONLY', automation: { enabled: false, missing_gates: ['G1','G8'] }, scanner: 'UNAVAILABLE', readiness: fixtureDouble('readiness-nothing-available'), role, can: { capture: role === 'quality_inspector', create_sample: role === 'quality_inspector', confirm_spec: role === 'purchase_manager', adjudicate: role === 'supervisor', manage_release: false }, limits: {} }
   : path === '/purchase-orders' ? { items: [{ purchase_order_id: specDouble.purchase_order_id, reference: 'PO test double', supplier_name: 'Supplier test double', status: 'confirmed', current_spec: { id: specDouble.id, version: 1, confirmed_at: specDouble.confirmed_at, construction: 'woven' } }] }
   : path.startsWith('/specs/') ? { spec: specDouble, current: true, versions: [1] }
   : path === '/consent-authorities' ? { items: [fixtureDouble('consent-operational-only')] }
   : path === '/samples' ? { items: [] } : result;
  await route.fulfill({ json: value, headers: { 'Cache-Control': 'no-store' } });
 });
 return specDouble;
}
test.describe('guided QC contract rendering (API doubles)', () => {
 test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });
 test.beforeEach(async ({ page }) => { await page.request.post('/__test/reset'); });
 test('sample scope, review banner, unknown fabric, all stages, history and keyboard/axe', async ({ page }) => {
  const result = resultDouble(); await apiDouble(page, result); await signIn(page, 'Qasim'); await page.goto(`/#/incoming-qc/${result.sample.id}`);
  await expect(page.getByText('REVIEW ONLY', { exact: true })).toBeVisible();
  await expect(page.getByText('This decision covers only this inspected sample, not the roll.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Needs manual review' })).toBeFocused();
  for (const stage of ['Photo quality', 'Fabric type', 'Defect check', 'Thread count', 'Validated conditions']) await expect(page.getByTestId('qc-stages')).toContainText(stage);
  await expect(page.getByTestId('qc-fabric')).toContainText('unknown');
  await expect(page.getByText('Decision history', { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).include('.incoming-qc').analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Reload sample', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Needs manual review' })).toBeFocused();
 });
 test('stale specification offers linked evaluation and requires new captures; third attempt escalates', async ({ page }) => {
  const result = fixtureDouble('result-spec-stale'); result.family.attempts_used = 3; await apiDouble(page, result); await signIn(page, 'Qasim'); await page.goto(`/#/incoming-qc/${result.sample.id}`);
  await expect(page.getByText('PO_VERSION_STALE', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start linked evaluation under the current specification' })).toBeVisible();
  await expect(page.getByText(/New photographs are required/)).toBeVisible();
  await expect(page.getByText(/3 of 3/).first()).toBeVisible(); await expect(page.getByText(/Ask a supervisor to inspect this sample/)).toBeVisible();
 });
 test('read-only role cannot capture or confirm and Urdu isolates identifiers', async ({ page }) => {
  const result = resultDouble(); await apiDouble(page, result, 'sales_manager'); await signIn(page, 'Sana'); await page.goto(`/#/incoming-qc/${result.sample.id}`);
  await expect(page.getByText('Read-only view', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Upload originals' })).toHaveCount(0);
  await page.goto('/#/app-settings'); await page.getByRole('button', { name: /Switch language to Urdu/ }).click(); await page.goto(`/#/incoming-qc/${result.sample.id}`);
  await expect(page.locator('.incoming-qc')).toHaveAttribute('dir','rtl'); expect(await page.locator('.incoming-qc bdi[dir=ltr]').count()).toBeGreaterThan(0);
 });
 test('editing immediately hides previous result and ignores a deferred reload', async ({ page }) => {
  const result = resultDouble(); await apiDouble(page, result); await signIn(page, 'Qasim'); await page.goto(`/#/incoming-qc/${result.sample.id}`);
  await expect(page.getByTestId('qc-result')).toBeVisible(); let release!: () => void;
  await page.route(`**/api/qc/v2/samples/${result.sample.id}`, async route => { await new Promise<void>(resolve => release = resolve); await route.fulfill({ json: result }); });
  await page.getByRole('button', { name: 'Reload sample', exact: true }).click();
  await page.getByLabel('Device profile reference').fill('changed-unvalidated-device');
  release(); await expect(page.getByTestId('qc-result')).toHaveCount(0);
 });
 test('two tabs offline logout purges draft previews and drops a late response', async ({ page, context }) => {
  const result = resultDouble(); await apiDouble(page, result); await signIn(page, 'Qasim'); await page.goto(`/#/incoming-qc/${result.sample.id}`);
  const second = await context.newPage(); await apiDouble(second, result); await second.goto(`/#/incoming-qc/${result.sample.id}`); await expect(second.getByTestId('qc-result')).toBeVisible();
  await context.setOffline(true); await page.goto('/#/profile');
  if (await page.locator('.live-bottom-nav').isVisible()) await page.getByRole('button', { name: /More pages/ }).click();
  await page.getByRole('button', { name: 'Sign out Qasim' }).filter({ visible: true }).click();
  await expect(second.getByTestId('qc-result')).toHaveCount(0); await expect(second.getByRole('heading', { name: 'Who’s signing in?', exact: true })).toBeVisible();
  await context.setOffline(false);
 });
});
// Built service-worker proof uses actual network responses and a public shell, never route mocks.
test('built worker caches public shell while private original bytes remain unrecoverable offline', async ({ page, context }) => {
 await page.request.post('/__test/reset'); await signIn(page, 'Qasim');
 await page.evaluate(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true })); });
 const privatePath = '/api/qc/v2/captures/00000000-0000-4000-8000-000000000000/original';
 await page.evaluate(path => new Promise(resolve => { const image = new Image(); image.onload = image.onerror = () => resolve(null); image.src = path; }), privatePath);
 const cacheKeys = await page.evaluate(async () => { const urls: string[] = []; for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) urls.push(req.url); return urls; });
 expect(cacheKeys.some(url => new URL(url).pathname.startsWith('/api/'))).toBe(false);
 expect(cacheKeys.some(url => new URL(url).pathname === '/')).toBe(true);
 await context.setOffline(true);
 expect(await page.evaluate(async path => { try { const r = await fetch(path); return r.ok; } catch { return false; } }, privatePath)).toBe(false);
 await page.goto('/'); await expect(page.locator('body')).not.toBeEmpty(); await context.setOffline(false);
});
