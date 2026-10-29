import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import QRCode from 'qrcode';
import { apiPost, origin, seededLot, signIn, workspace } from './helpers';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => { await page.request.post('/__test/reset'); });

test.describe('Shared inventory', () => {
  test('finished goods remain recorded and immediate stock dispatch is closed', async ({ page }) => {
    await signIn(page, 'Saima');
    const product = await apiPost<{ id: string }>(page, '/products', { sku: 'COT-30', name: 'Cotton combed 30/1', barcode: '8901234567890' });
    await page.goto('/#/inventory');
    await page.getByLabel('Material', { exact: true }).selectOption(product.id);
    await page.getByLabel('Batch / dye lot', { exact: true }).fill('DYE-001');
    await page.getByRole('form', { name: 'Add finished goods' }).getByLabel('Weight (kg)', { exact: true }).fill('5');
    await page.getByRole('button', { name: 'Save finished goods', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Finished goods recorded.' })).toBeVisible();
    // Finished goods are recorded with their type and source; raw stock still arrives only through an inspection report.
    const finished = (await workspace(page)).lots.find((l: { batch: string }) => l.batch === 'DYE-001');
    expect([finished.inventory_type, finished.source, finished.quality]).toEqual(['finished', 'production', 'approved']);
    // Legacy stock dispatch is closed; only the order approval flow may deduct stock.
    const { lot, state: seeded } = await seededLot(page, 'LOT-1024');
    const rawBefore = seeded.balances.find((balance: { lot_id: string; stage: string }) => balance.lot_id === lot.id && balance.stage === 'finished')!.grams;
    const movementsBefore = seeded.movements.filter((movement: { lot_id: string }) => movement.lot_id === lot.id).length;
    const legacy = await page.request.post('/api/movements', { headers: { Origin: origin }, data: { id: crypto.randomUUID(), lotId: lot.id, action: 'dispatch', stage: 'finished', grams: 1250, cartons: 0, cones: 0, note: 'Legacy attempt' } });
    expect(legacy.status()).toBe(404);
    const after = await workspace(page);
    expect(after.balances.find((balance: { lot_id: string; stage: string }) => balance.lot_id === lot.id && balance.stage === 'finished')!.grams).toBe(rawBefore);
    expect(after.movements.filter((movement: { lot_id: string }) => movement.lot_id === lot.id)).toHaveLength(movementsBefore);
    await page.goto('/#/history');
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

});

test('nobody can change stock through the old receive and QC writes', async ({ page }) => {
  await page.request.post('/__test/reset');
  const { lot } = await seededLot(await (async () => { await signIn(page, 'Qasim'); return page; })(), 'LOT-1022');
  const before = await workspace(page);
  const write = async (path: string, data: object) => (await page.request.post('/api' + path, { data, headers: { Origin: origin } })).status();
  expect(await write('/quality', { lotId: lot.id, status: 'approved', note: 'Inspector approves' })).toBe(404);
  expect(await write('/inspections', { id: crypto.randomUUID(), lotId: lot.id, labelText: '', note: 'Old-style inspection', result: null })).toBe(404);
  await page.context().clearCookies();
  await signIn(page, 'Pervaiz');
  expect(await write('/movements', { id: crypto.randomUUID(), lotId: lot.id, action: 'receive', stage: 'raw', grams: 1000, cartons: 0, cones: 0, note: 'Old-style receipt' })).toBe(404);
  await page.context().clearCookies();
  await signIn(page, 'Anas');
  expect(await write('/movements', { id: crypto.randomUUID(), lotId: lot.id, action: 'receive', stage: 'raw', grams: 1000, cartons: 0, cones: 0, note: 'Admin old-style receipt' })).toBe(404);
  expect(await write('/quality', { lotId: lot.id, status: 'hold', note: 'Admin old-style hold' })).toBe(404);
  const after = await workspace(page);
  expect(after.movements).toEqual(before.movements); expect(after.lots.find((l: { id: string }) => l.id === lot.id).quality).toBe(before.lots.find((l: { id: string }) => l.id === lot.id).quality);
});
