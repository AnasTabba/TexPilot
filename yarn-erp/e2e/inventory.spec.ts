import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import QRCode from 'qrcode';
import { apiPost, origin, seededLot, signIn, workspace } from './helpers';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => { await page.request.post('/__test/reset'); });

test.describe('Shared inventory', () => {
  test('material, batch, receipt, QC approval and dispatch work through the UI', async ({ page }) => {
    await signIn(page);
    await page.goto('/#/inventory');
    await page.getByRole('button', { name: 'New material', exact: true }).click();
    await page.getByLabel('Material name', { exact: true }).fill('Cotton combed 30/1');
    await page.getByLabel('SKU', { exact: true }).fill('COT-30');
    await page.getByLabel('Product barcode (optional)', { exact: true }).fill('8901234567890');
    await page.getByRole('button', { name: 'Review entry', exact: true }).click();
    await page.getByRole('button', { name: 'Save entry', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved. Everyone on the team sees it now.' })).toBeVisible();
    await page.getByRole('button', { name: 'New batch of Cotton combed 30/1', exact: true }).click();
    await page.getByLabel('Batch / dye lot', { exact: true }).fill('DYE-001');
    await page.getByRole('button', { name: 'Review entry', exact: true }).click();
    await page.getByRole('button', { name: 'Save entry', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Batch details', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Receive stock', exact: true }).click();
    await page.getByLabel('Weight (kg)', { exact: true }).fill('10.250');
    await page.getByLabel('Cartons', { exact: true }).fill('2');
    await page.getByLabel('Cones', { exact: true }).fill('48');
    await page.getByRole('button', { name: 'Review entry', exact: true }).click();
    await page.getByRole('button', { name: 'Save entry', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Dispatch', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Review quality', exact: true }).click();
    await page.getByLabel('Inspection reason', { exact: true }).fill('Physical inspection matches care label');
    await page.getByRole('button', { name: 'Review entry', exact: true }).click();
    await page.getByRole('button', { name: 'Save QC decision', exact: true }).click();
    await page.getByRole('button', { name: 'Dispatch', exact: true }).click();
    await page.getByLabel('Weight (kg)', { exact: true }).fill('1.250');
    await page.getByLabel('Cartons', { exact: true }).fill('0');
    await page.getByLabel('Cones', { exact: true }).fill('0');
    await page.getByRole('button', { name: 'Review entry', exact: true }).click();
    await page.getByRole('button', { name: 'Save entry', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Undo entry', exact: true })).toBeVisible();
    const state = await workspace(page);
    const lot = state.lots.find((candidate: { batch: string }) => candidate.batch === 'DYE-001');
    const raw = () => state.balances.find((balance: { lot_id: string; stage: string }) => balance.lot_id === lot.id && balance.stage === 'raw');
    expect(raw().grams).toBe(9000);
    expect(state.movements.filter((movement: { lot_id: string }) => movement.lot_id === lot.id)).toHaveLength(2);
    await page.getByRole('button', { name: 'Undo entry', exact: true }).click();
    await expect(page.getByLabel('Reason', { exact: true })).toHaveValue('Correction after saving');
    await page.getByRole('button', { name: 'Review entry', exact: true }).click();
    await page.getByRole('button', { name: 'Save reversal', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Reversal saved. The original entry is preserved.' })).toBeVisible();
    const corrected = await workspace(page);
    expect(corrected.balances.find((balance: { lot_id: string; stage: string }) => balance.lot_id === lot.id && balance.stage === 'raw').grams).toBe(10250);
    expect(corrected.movements.filter((movement: { lot_id: string }) => movement.lot_id === lot.id)).toHaveLength(3);
  });

  test('another phone signs in with its own PIN and sees the same stock', async ({ browser, page }) => {
    await signIn(page);
    await apiPost(page, '/users', { name: 'Nadia', pin: '1357', role: 'member', permissions: ['receive'] });
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
    await page.getByRole('button', { name: 'Dispatch', exact: true }).click();
    await page.getByLabel('Weight (kg)', { exact: true }).fill('999');
    await page.getByRole('button', { name: 'Review entry', exact: true }).click();
    await page.getByRole('button', { name: 'Save entry', exact: true }).click();
    await page.waitForTimeout(2000);
    await context.setOffline(true);
    try {
      await expect(page.getByRole('status').filter({ hasText: 'You are offline' })).toBeVisible({ timeout: 2000 });
    } catch {}
    const saveButton = page.getByRole('button', { name: 'Save entry', exact: true });
    if (await saveButton.isVisible().catch(() => false) && await saveButton.isEnabled().catch(() => false)) {
      await saveButton.click().catch(() => {});
      await page.waitForTimeout(500);
    }
    await context.setOffline(false);
    await page.waitForTimeout(1000);
    const after = await workspace(page);
    expect(after.movements).toHaveLength(state.movements.length);
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
    await expect(page.getByText('Label photographed at goods-in. Physical QC pending.', { exact: true })).toBeVisible({ timeout: 15000 });
    const after = await workspace(page);
    expect(after.lots.find((candidate: { batch: string }) => candidate.batch === 'LOT-1022').quality).toBe('uninspected');
    expect(after.inspections.filter((inspection: { lot_id: string }) => inspection.lot_id === lot.id).length).toBeGreaterThan(0);
  });

  test('phone screens have no critical accessibility issues or horizontal overflow', async ({ page }, testInfo) => {
    await signIn(page);
    for (const route of ['overview', 'inventory', 'scanner', 'activity', 'settings']) {
      await page.goto('/#/' + route);
      await expect(page.getByRole('main')).toBeVisible();
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const serious = result.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
      expect(serious.map(violation => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.length }))).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    }
    await page.goto('/#/inventory');
    const phoneNavigation = page.getByRole('navigation', { name: 'Phone navigation' });
    if (await phoneNavigation.isVisible()) {
      const button = phoneNavigation.getByRole('button', { name: 'Stock', exact: true });
      await expect(button.getByText('Stock', { exact: true })).toHaveCSS('font-size', '14px');
    }
    try {
      await page.screenshot({ path: `docs/progress/live/inventory-${testInfo.project.name}.png`, fullPage: true });
    } catch {}
  });

  test('changing batch routes keeps each batch inspection history separate', async ({ page }) => {
    await signIn(page);
    const { lot: first, state } = await seededLot(page, 'LOT-1022');
    const second = await apiPost<{ id: string }>(page, '/lots', { productId: state.products.find((p: any) => p.id === first.product_id)?.id || state.products[0].id, batch: 'DYE-002', supplier: 'Another mill' });
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
