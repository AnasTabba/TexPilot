import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import QRCode from 'qrcode';

const origin = 'http://127.0.0.1:8791';
async function post(page: Page, path: string, data: object) {
  const response = await page.request.post('/api' + path, { data, headers: { Origin: origin } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function createWorkspace(page: Page, user: string) {
  await page.context().setExtraHTTPHeaders({ 'x-yarnflow-test-user': user });
  await page.goto('/');
  await page.getByLabel('Workspace name').fill('Yarnflow phone testing');
  await page.getByRole('form', { name: 'Start your shared workspace' }).getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inventory.', exact: true })).toBeVisible();
}
async function createStock(page: Page) {
  const product = await post(page, '/products', { name: 'Cotton combed 30/1', sku: 'COT-30', barcode: '8901234567890' });
  const lot = await post(page, '/lots', { productId: product.id, batch: 'DYE-001', supplier: 'Testing mill' });
  await post(page, '/movements', { id: crypto.randomUUID(), lotId: lot.id, action: 'receive', stage: 'raw', grams: 10000, cartons: 2, cones: 48, note: 'Initial test stock' });
  return lot;
}

test.describe('Shared inventory', () => {
  test('material, batch, receipt, QC approval and dispatch work through the UI', async ({ page }) => {
    await createWorkspace(page, 'workflow-' + crypto.randomUUID());
    await page.getByRole('button', { name: 'Add material', exact: true }).click();
    await page.getByLabel('Material name', { exact: true }).fill('Cotton combed 30/1');
    await page.getByLabel('SKU', { exact: true }).fill('COT-30');
    await page.getByRole('button', { name: 'Save to workspace', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved to your shared workspace.' })).toBeVisible();
    await page.getByRole('button', { name: 'New batch', exact: true }).click();
    await page.getByLabel('Batch / dye lot', { exact: true }).fill('DYE-001');
    await page.getByRole('button', { name: 'Save to workspace', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Batch details', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Receive stock', exact: true }).click();
    await page.getByLabel('Weight (kg)', { exact: true }).fill('10.250');
    await page.getByLabel('Cartons', { exact: true }).fill('2');
    await page.getByLabel('Cones', { exact: true }).fill('48');
    await page.getByRole('button', { name: 'Save to workspace', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Dispatch', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Review quality', exact: true }).click();
    await page.getByLabel('Inspection reason', { exact: true }).fill('Physical inspection matches care label');
    await page.getByRole('button', { name: 'Save QC decision', exact: true }).click();
    await page.getByRole('button', { name: 'Dispatch', exact: true }).click();
    await page.getByLabel('Weight (kg)', { exact: true }).fill('1.250');
    await page.getByLabel('Cartons', { exact: true }).fill('0');
    await page.getByLabel('Cones', { exact: true }).fill('0');
    await page.getByRole('button', { name: 'Save to workspace', exact: true }).click();
    const state = await (await page.request.get('/api/workspace')).json();
    expect(state.balances[0].grams).toBe(9000);
    expect(state.movements).toHaveLength(2);
  });

  test('another phone joins the same workspace and barcode lookup opens its batch', async ({ browser, page }) => {
    await createWorkspace(page, 'owner-' + crypto.randomUUID());
    const lot = await createStock(page);
    const invite = await post(page, '/invites', {});
    const friend = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 }, extraHTTPHeaders: { 'x-yarnflow-test-user': 'friend-' + crypto.randomUUID() } });
    const phone = await friend.newPage();
    await phone.goto('/#/join/' + invite.code);
    await phone.getByRole('form', { name: 'Join your team' }).getByRole('button', { name: 'Join workspace', exact: true }).click();
    await expect(phone.getByRole('button', { name: /Cotton combed 30\/1/ })).toBeVisible();
    await phone.getByRole('navigation', { name: 'Phone navigation' }).getByRole('button', { name: 'Scanner', exact: true }).click();
    await phone.getByLabel('Barcode or batch number', { exact: true }).fill('YF:' + lot.id);
    await phone.getByRole('button', { name: 'Find batch', exact: true }).click();
    await expect(phone.getByRole('heading', { name: 'Batch details', exact: true })).toBeVisible();
    await expect(phone.getByRole('button', { name: 'Review quality', exact: true })).toHaveCount(0);
    const snapshot = await (await phone.request.get('/api/workspace')).json();
    expect(snapshot.balances[0].grams).toBe(10000);
    await friend.close();
  });

  test('a real generated QR photo is decoded and looks up its stock record', async ({ page }) => {
    await createWorkspace(page, 'qr-' + crypto.randomUUID());
    const lot = await createStock(page);
    await page.goto('/#/scanner');
    const image = await QRCode.toBuffer('YF:' + lot.id, { width: 480, margin: 4 });
    await page.getByLabel('Read barcode photo', { exact: true }).setInputFiles({ name: 'batch.png', mimeType: 'image/png', buffer: image });
    await expect(page.getByRole('heading', { name: 'Batch details', exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: 'QR code for batch DYE-001' })).toBeVisible();
  });

  test('a failed save keeps the draft and offline mode never claims it was shared', async ({ page, context }) => {
    await createWorkspace(page, 'offline-' + crypto.randomUUID());
    const lot = await createStock(page);
    await page.getByRole('button', { name: 'Refresh inventory', exact: true }).click();
    await page.getByRole('button', { name: /Cotton combed 30\/1/ }).click();
    await page.getByRole('button', { name: 'Move stock', exact: true }).click();
    await page.getByLabel('Weight (kg)', { exact: true }).fill('999');
    await page.getByRole('button', { name: 'Save to workspace', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Stock changed' })).toBeVisible();
    await expect(page.getByLabel('Weight (kg)', { exact: true })).toHaveValue('999');
    await context.setOffline(true);
    await expect(page.getByRole('button', { name: 'Save to workspace', exact: true })).toBeDisabled();
    await expect(page.getByRole('status').filter({ hasText: 'Offline · writes paused' })).toBeVisible();
    await context.setOffline(false);
    expect(lot.id).toBeTruthy();
  });

  test('an inspection photo is saved and visible after reopening the batch', async ({ page }) => {
    await createWorkspace(page, 'photo-' + crypto.randomUUID());
    const lot = await createStock(page);
    await page.goto('/#/inventory/' + lot.id);
    await page.getByRole('button', { name: 'Refresh inventory', exact: true }).click();
    await page.getByRole('button', { name: 'Record inspection', exact: true }).click();
    await page.getByLabel('Care-label text (optional)', { exact: true }).fill('100% COTTON');
    await page.getByLabel('Notes', { exact: true }).fill('Label photographed at goods-in. Physical QC pending.');
    const image = await QRCode.toBuffer('Inspection photo fixture', { width: 240 });
    await page.getByLabel('Inspection photo (optional)', { exact: true }).setInputFiles({ name: 'inspection.png', mimeType: 'image/png', buffer: image });
    await page.getByRole('button', { name: 'Save inspection', exact: true }).click();
    const evidence = page.getByRole('img', { name: 'Inspection evidence for batch DYE-001' });
    await evidence.scrollIntoViewIfNeeded();
    await expect(evidence).toBeVisible();
    await expect.poll(() => evidence.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await page.reload();
    await expect(page.getByText('Label photographed at goods-in. Physical QC pending.', { exact: true })).toBeVisible();
    const snapshot = await (await page.request.get('/api/workspace')).json();
    expect(snapshot.lots[0].quality).toBe('uninspected');
    expect(snapshot.photos).toHaveLength(1);
    expect((await page.request.get('/api/photos/' + snapshot.photos[0].id)).status()).toBe(200);
  });

  test('phone screens have no critical accessibility issues or horizontal overflow', async ({ page }, testInfo) => {
    await createWorkspace(page, 'accessibility-' + crypto.randomUUID());
    await createStock(page);
    await page.getByRole('button', { name: 'Refresh inventory', exact: true }).click();
    for (const route of ['overview', 'inventory', 'scanner', 'activity', 'settings']) {
      await page.goto('/#/' + route);
      await expect(page.getByRole('main')).toBeVisible();
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }))).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    }
    await page.goto('/#/inventory');
    const phoneNavigation = page.getByRole('navigation', { name: 'Phone navigation' });
    if (await phoneNavigation.isVisible()) {
      const button = phoneNavigation.getByRole('button', { name: 'Inventory', exact: true });
      await expect(button.getByText('Inventory', { exact: true })).toHaveCSS('font-size', '12px');
    }
    await page.screenshot({ path: `docs/progress/live/inventory-${testInfo.project.name}.png`, fullPage: true });
  });

  test('changing batch routes keeps each batch inspection history separate', async ({ page }) => {
    await createWorkspace(page, 'batch-history-' + crypto.randomUUID());
    const first = await createStock(page);
    const snapshot = await (await page.request.get('/api/workspace')).json();
    const second = await post(page, '/lots', { productId: snapshot.products[0].id, batch: 'DYE-002', supplier: 'Another mill' });
    await post(page, '/inspections', { id: crypto.randomUUID(), lotId: first.id, labelText: '', note: 'Only the first batch has this inspection', result: null });
    await post(page, '/inspections', { id: crypto.randomUUID(), lotId: second.id, labelText: '', note: 'Only the second batch has this inspection', result: null });
    await page.goto('/#/inventory/' + first.id);
    await page.getByRole('button', { name: 'Refresh inventory', exact: true }).click();
    await expect(page.getByText('Only the first batch has this inspection', { exact: true })).toBeVisible();
    await page.goto('/#/inventory/' + second.id);
    await expect(page.getByText('Only the second batch has this inspection', { exact: true })).toBeVisible();
    await expect(page.getByText('Only the first batch has this inspection', { exact: true })).toHaveCount(0);
  });
});
