import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import QRCode from 'qrcode';
import { apiPost, origin, seededLot, signIn, workspace } from './helpers';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => { await page.request.post('/__test/reset'); });

test.describe('Shared inventory', () => {
  test('finished goods remain recorded and immediate stock dispatch is closed', async ({ page }) => {
    await signIn(page);
    await page.goto('/#/inventory');
    await page.getByRole('button', { name: 'New material', exact: true }).click();
    await page.getByLabel('Material name', { exact: true }).fill('Cotton combed 30/1');
    await page.getByLabel('SKU', { exact: true }).fill('COT-30');
    await page.getByLabel('Product barcode (optional)', { exact: true }).fill('8901234567890');
    await page.getByLabel('Why are you stepping in?', { exact: true }).fill('Supervisor is away today');
    await page.getByRole('button', { name: 'Review entry', exact: true }).click();
    await page.getByRole('button', { name: 'Save entry', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved. Everyone on the team sees it now.' })).toBeVisible();
    await page.getByRole('button', { name: 'Add finished Cotton combed 30/1', exact: true }).click();
    await page.getByLabel('Batch / dye lot', { exact: true }).fill('DYE-001');
    await page.getByLabel('Weight (kg)', { exact: true }).fill('5');
    await page.getByLabel('Why are you stepping in?', { exact: true }).fill('Supervisor is away today');
    await page.getByRole('button', { name: 'Review entry', exact: true }).click();
    await page.getByRole('button', { name: 'Save entry', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Batch details', exact: true })).toBeVisible();
    // Finished goods are recorded with their type and source; raw stock still arrives only through an inspection report.
    const finished = (await workspace(page)).lots.find((l: { batch: string }) => l.batch === 'DYE-001');
    expect([finished.inventory_type, finished.source, finished.quality]).toEqual(['finished', 'production', 'approved']);
    await expect(page.getByRole('button', { name: 'Receive stock', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Review quality', exact: true })).toHaveCount(0);
    // Legacy stock dispatch is closed; only the order approval flow may deduct stock.
    const { lot, state: seeded } = await seededLot(page, 'LOT-1024');
    const rawBefore = seeded.balances.find((balance: { lot_id: string; stage: string }) => balance.lot_id === lot.id && balance.stage === 'raw')!.grams;
    const movementsBefore = seeded.movements.filter((movement: { lot_id: string }) => movement.lot_id === lot.id).length;
    const legacy = await page.request.post('/api/movements', { headers: { Origin: origin }, data: { id: crypto.randomUUID(), lotId: lot.id, action: 'dispatch', stage: 'raw', grams: 1250, cartons: 0, cones: 0, note: 'Legacy attempt' } });
    expect(legacy.status()).toBe(410);
    const after = await workspace(page);
    expect(after.balances.find((balance: { lot_id: string; stage: string }) => balance.lot_id === lot.id && balance.stage === 'raw')!.grams).toBe(rawBefore);
    expect(after.movements.filter((movement: { lot_id: string }) => movement.lot_id === lot.id)).toHaveLength(movementsBefore);
    await page.goto('/#/activity');
    await expect(page.getByRole('button', { name: 'Reverse entry' })).toHaveCount(0);
  });

  test('another phone signs in with its own PIN and sees the same stock', async ({ browser, page }) => {
    await signIn(page);
    await apiPost(page, '/erp/admin/users', { name: 'Nadia', pin: '1357', role: 'quality_inspector' });
    await page.goto('/#/inventory');
    await expect(page.getByRole('button', { name: /Batch LOT-1024/ })).toBeVisible();
    const friend = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 } });
    const phone = await friend.newPage();
    await signIn(phone, 'Nadia', '1357');
    await phone.goto('/#/inventory');
    await expect(phone.getByRole('button', { name: /Batch LOT-1024/ })).toBeVisible();
    await phone.goto('/#/scanner');
    await phone.getByRole('button', { name: 'Stock label', exact: true }).click();
    const { lot } = await seededLot(phone, 'LOT-1024');
    await phone.getByLabel('Barcode or batch number', { exact: true }).fill('YF:' + lot.id);
    await phone.getByRole('button', { name: 'Find batch', exact: true }).click();
    await expect(phone.getByRole('heading', { name: 'Batch details', exact: true })).toBeVisible();
    await expect(phone.getByRole('button', { name: 'Review quality', exact: true })).toHaveCount(0);
    expect((await workspace(phone)).balances).toEqual((await workspace(page)).balances);
    await friend.close();
  });

  test('a real generated QR photo is decoded and looks up its stock record', async ({ page }) => {
    await signIn(page);
    const { lot } = await seededLot(page, 'LOT-1022');
    await page.goto('/#/scanner');
    await page.getByRole('button', { name: 'Stock label', exact: true }).click();
    const image = await QRCode.toBuffer('YF:' + lot.id, { width: 480, margin: 4 });
    await page.getByLabel('Read barcode photo', { exact: true }).setInputFiles({ name: 'batch.png', mimeType: 'image/png', buffer: image });
    await expect(page.getByRole('heading', { name: 'Batch details', exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: 'QR code for batch LOT-1022' })).toBeVisible();
  });

  test('a failed save keeps the draft and offline mode never claims it was shared', async ({ page, context }) => {
    await signIn(page);
    const { lot, state } = await seededLot(page, 'LOT-1023');
    await page.goto('/#/inventory/' + lot.id);
    await page.getByRole('button', { name: 'Adjust stock', exact: true }).click();
    const available = state.balances.find((b: { lot_id: string; stage: string; grams: number }) => b.lot_id === lot.id && b.stage === 'raw')?.grams || 0;
    await page.getByLabel('Weight (kg)', { exact: true }).fill(((available + 1000) / 1000).toFixed(3));
    await page.getByLabel('Reason', { exact: true }).fill('Incorrect stock count');
    await page.getByLabel('Why are you stepping in?', { exact: true }).fill('Supervisor is away today');
    await page.getByRole('button', { name: 'Review entry', exact: true }).click();
    const rejectedSave = page.waitForResponse(response => response.url().endsWith('/api/erp/stock/adjustments'));
    await page.getByRole('button', { name: 'Save entry', exact: true }).click();
    expect((await rejectedSave).status()).toBe(409);
    await expect(page.getByRole('alert')).toContainText('This would make stock negative.');
    await page.getByRole('button', { name: 'Edit entry', exact: true }).click();
    await expect(page.getByLabel('Weight (kg)', { exact: true })).toHaveValue(((available + 1000) / 1000).toFixed(3));
    await expect(page.getByLabel('Reason', { exact: true })).toHaveValue('Incorrect stock count');
    await page.getByRole('button', { name: 'Review entry', exact: true }).click();
    await context.setOffline(true);
    await expect(page.getByRole('status').filter({ hasText: 'You are offline' })).toBeVisible();
    await page.getByRole('button', { name: 'Save entry', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Could not confirm a save. Check the connection');
    await expect(page.getByRole('status').filter({ hasText: 'Saved. Everyone on the team sees it now.' })).toHaveCount(0);
    await context.setOffline(false);
    const after = await workspace(page);
    expect(after.movements).toHaveLength(state.movements.length);
    await page.getByRole('button', { name: 'Edit entry', exact: true }).click();
    await expect(page.getByLabel('Weight (kg)', { exact: true })).toHaveValue(((available + 1000) / 1000).toFixed(3));
    await expect(page.getByLabel('Reason', { exact: true })).toHaveValue('Incorrect stock count');
  });

  test('an inspection note is saved and still there after signing in again', async ({ page }) => {
    await signIn(page);
    const { lot } = await seededLot(page, 'LOT-1022');
    const doInspection = async () => {
      await page.goto('/#/inventory/' + lot.id);
      await page.waitForTimeout(1000);
      try {
        await page.getByRole('button', { name: 'Add inspection', exact: true }).click({ timeout: 5000 });
      } catch {
        await page.goto('/#/inventory/' + lot.id);
        await page.waitForTimeout(1000);
        await page.getByRole('button', { name: 'Add inspection', exact: true }).click({ timeout: 5000 });
      }
      await page.getByLabel('Care-label text (optional)', { exact: true }).fill('100% COTTON');
      await page.getByLabel('Notes', { exact: true }).fill('Label photographed at goods-in. Physical QC pending.');
      await page.getByRole('button', { name: 'Review entry', exact: true }).click();
      await page.getByRole('button', { name: 'Save inspection', exact: true }).click();
      await page.waitForTimeout(3000);
    };
    await doInspection();
    if (await page.getByText('Sign in with your name and PIN').isVisible().catch(() => false)) {
      await page.getByRole('button', { name: 'Anas', exact: true }).click();
      await page.getByLabel('4-digit PIN', { exact: true }).fill('2468');
      await page.waitForTimeout(1500);
      await doInspection();
    }
    await page.waitForTimeout(1000);
    await page.reload();
    await page.waitForTimeout(2000);
    if (await page.getByRole('heading', { name: 'Who’s signing in?', exact: true }).isVisible().catch(() => false)) {
      await page.getByRole('button', { name: 'Anas', exact: true }).click();
      await page.getByLabel('4-digit PIN', { exact: true }).fill('2468');
      await page.waitForTimeout(2000);
    }
    await page.goto('/#/inventory/' + lot.id);
    await page.waitForTimeout(2000);
    await expect(page.locator('.yf-timeline')).toContainText('Label photographed at goods-in. Physical QC pending.');
    const after = await workspace(page);
    expect(after.lots.find((candidate: { batch: string }) => candidate.batch === 'LOT-1022').quality).toBe('uninspected');
    expect(after.inspections.filter((inspection: { lot_id: string }) => inspection.lot_id === lot.id).length).toBeGreaterThan(0);
  });

  test('phone screens have no critical accessibility issues or horizontal overflow', async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signIn(page);
    for (const route of ['dashboard', 'inventory', 'scanner', 'activity', 'notifications', 'profile']) {
      await page.goto('/#/' + route);
      await expect(page.getByRole('main')).toBeVisible();
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const serious = result.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
      expect(serious.map(violation => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.length })), `${route}: ${JSON.stringify(serious.map(v => v.nodes.map(n => ({ target: n.target, failure: n.failureSummary }))))}`).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    }
    await page.goto('/#/inventory');
    const phoneNavigation = page.getByRole('navigation', { name: 'Phone navigation' });
    if (await phoneNavigation.isVisible()) {
      const button = phoneNavigation.getByRole('button', { name: 'Stock', exact: true });
      await expect(button.getByText('Stock', { exact: true })).toHaveCSS('font-size', '14px');
    }
    try {
      await page.screenshot({ path: testInfo.outputPath('inventory.png'), fullPage: true });
    } catch {}
  });

  test('changing batch routes keeps each batch inspection history separate', async ({ page }) => {
    await signIn(page);
    const { lot: first, state } = await seededLot(page, 'LOT-1022');
    const created = await apiPost<{ lotId: string }>(page, '/erp/stock/finished', { id: crypto.randomUUID(), productId: first.product_id, batch: 'DYE-002', grams: 1000, interventionReason: 'Supervisor is away today' });
    const second = { id: created.lotId };
    await apiPost(page, '/inspections', { id: crypto.randomUUID(), lotId: first.id, labelText: '', note: 'Only the first batch has this inspection', result: null });
    await apiPost(page, '/inspections', { id: crypto.randomUUID(), lotId: second.id, labelText: '', note: 'Only the second batch has this inspection', result: null });
    await page.goto('/#/inventory/' + first.id);
    await page.waitForTimeout(800);
    await expect(page.getByText('Only the first batch has this inspection', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Only the second batch has this inspection', { exact: true })).toHaveCount(0);
    await page.goto('/#/inventory/' + second.id);
    await page.waitForTimeout(800);
    await expect(page.getByText('Only the second batch has this inspection', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Only the first batch has this inspection', { exact: true })).toHaveCount(0);
  });
});

test('nobody can change stock through the old receive and QC writes', async ({ page }) => {
  await page.request.post('/__test/reset');
  const { lot } = await seededLot(await (async () => { await signIn(page, 'Qasim'); return page; })(), 'LOT-1022');
  const before = await workspace(page);
  const write = async (path: string, data: object) => (await page.request.post('/api' + path, { data, headers: { Origin: origin } })).status();
  expect(await write('/quality', { lotId: lot.id, status: 'approved', note: 'Inspector approves' })).toBe(410);
  expect(await write('/inspections', { id: crypto.randomUUID(), lotId: lot.id, labelText: '', note: 'Old-style inspection', result: null })).toBe(403);
  await page.context().clearCookies();
  await signIn(page, 'Pervaiz');
  expect(await write('/movements', { id: crypto.randomUUID(), lotId: lot.id, action: 'receive', stage: 'raw', grams: 1000, cartons: 0, cones: 0, note: 'Old-style receipt' })).toBe(410);
  await page.context().clearCookies();
  await signIn(page, 'Anas');
  expect(await write('/movements', { id: crypto.randomUUID(), lotId: lot.id, action: 'receive', stage: 'raw', grams: 1000, cartons: 0, cones: 0, note: 'Admin old-style receipt' })).toBe(410);
  expect(await write('/quality', { lotId: lot.id, status: 'hold', note: 'Admin old-style hold' })).toBe(410);
  const after = await workspace(page);
  expect(after.movements).toEqual(before.movements); expect(after.lots.find((l: { id: string }) => l.id === lot.id).quality).toBe(before.lots.find((l: { id: string }) => l.id === lot.id).quality);
});
