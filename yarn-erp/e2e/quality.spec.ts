import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { apiPost, seedQcLots, signIn } from './helpers';

test.beforeEach(async ({ page, isMobile }) => { test.skip(isMobile, 'These specs drive the desktop sidebar; the phone bottom navigation is covered by purchase-mobile.spec.'); await page.request.post('/__test/reset'); });

test('quality inspector gets oldest-lot dashboard and inspection-only navigation', async ({ page }, testInfo) => {
  await signIn(page, 'Qasim');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('button', { name: /^Lots/ })).toBeVisible();
  await expect(nav.getByRole('button', { name: /^My submissions/ })).toBeVisible();
  await expect(nav.getByRole('button', { name: /^Stock/ })).toHaveCount(0);
  await expect(page.getByText(/oldest waiting lot|No lots are waiting/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('quality-dashboard-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('quality-dashboard-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: /^Lots/ }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Lots to inspect' })).toBeVisible();
  await expect(page.getByText(/purchase manager registers an arrival/i)).toBeVisible();
  await page.getByRole('button', { name: /^My submissions/ }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'My submissions' })).toBeVisible();
  await page.getByRole('button', { name: 'Returned', exact: true }).click();
  await expect(page.getByRole('heading', { level: 3, name: 'Returned items' })).toBeVisible();
  await nav.getByRole('button', { name: /^My profile/ }).click();
  await page.getByRole('button', { name: /Switch language to Urdu/ }).click();
  await page.goto('/#/submissions/returned');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 3, name: 'واپس شدہ آئٹمز' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('quality-returned-urdu.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('quality-returned-urdu-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('inspector screens never expose inventory or quality decision controls', async ({ page }) => {
  await signIn(page, 'Qasim');
  for (const route of ['dashboard', 'lots', 'submissions']) {
    await page.goto('/#/' + route);
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('button', { name: /Accept report|Reject report|Confirm rejection|Adjust stock|Receive stock/ })).toHaveCount(0);
  }
});

test('inspector submits photo and issue evidence; supervisor accepts stock and returns another report with a reason', async ({ browser, page, baseURL }) => {
  await signIn(page, 'Anas');
  const [{ id: firstLotId }, { id: secondLotId }] = (await seedQcLots(page, ['QI-E2E-ACCEPT', 'QI-E2E-RETURN'])).lots as { id: string }[];
  const inspectorContext = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
  const inspector = await inspectorContext.newPage();
  try {
    await signIn(inspector, 'Qasim');
    await inspector.goto('/#/lots');
    const firstCard = inspector.locator('.erp-record').filter({ hasText: 'QI-E2E-ACCEPT' });
    await firstCard.getByRole('button', { name: 'Record inspection' }).click();
    await inspector.getByLabel('Accepted quantity (kg)', { exact: true }).fill('8');
    await inspector.getByLabel('Rejected quantity (kg)', { exact: true }).fill('2');
    await inspector.getByRole('button', { name: 'Save draft' }).click();
    await inspector.getByRole('button', { name: 'Submit inspection' }).click();
    await expect(inspector.getByRole('alert').filter({ hasText: 'Upload at least one photo of the accepted quantity.' })).toBeVisible();
    const jpeg = readFileSync(new URL('./fixtures/qc-evidence.jpg', import.meta.url));
    const photo = { name: 'accepted-quantity.jpg', mimeType: 'image/jpeg', buffer: jpeg };
    await inspector.getByLabel('Photo of the accepted quantity').setInputFiles(photo);
    await expect(inspector.getByRole('img', { name: /^Photo taken/ })).toBeVisible();
    await inspector.getByRole('button', { name: 'Submit inspection' }).click();
    await expect(inspector.getByRole('alert').filter({ hasText: 'Describe at least one issue for the rejected quantity.' })).toBeVisible();
    await inspector.getByRole('button', { name: 'Add an issue' }).click();
    await inspector.getByLabel('Issue type').fill('Shade variation');
    await inspector.getByLabel('Severity').selectOption('major');
    await inspector.getByLabel('Description').fill('Dye differs from the approved shade sample');
    await inspector.getByRole('button', { name: 'Save issue' }).click();
    await inspector.getByRole('button', { name: 'Submit inspection' }).click();
    await inspector.goto('/#/submissions');
    await expect(inspector.getByText('waiting for the supervisor').first()).toBeVisible();
    const acceptedInspection = (await inspector.request.get('/api/erp/qc/inspections?mine=1&status=submitted').then(r => r.json())).inspections[0];
    expect(acceptedInspection.photos).toHaveLength(1);
    expect(acceptedInspection.issues[0]).toMatchObject({ type: 'Shade variation', severity: 'major' });

    await inspector.goto('/#/lots');
    const secondCard = inspector.locator('.erp-record').filter({ hasText: 'QI-E2E-RETURN' });
    await secondCard.getByRole('button', { name: 'Record inspection' }).click();
    await inspector.getByLabel('Accepted quantity (kg)', { exact: true }).fill('1');
    await inspector.getByLabel('Rejected quantity (kg)', { exact: true }).fill('1');
    await inspector.getByRole('button', { name: 'Save draft' }).click();
    await inspector.getByLabel('Photo of the accepted quantity').setInputFiles(photo);
    await inspector.getByRole('button', { name: 'Add an issue' }).click();
    await inspector.getByLabel('Issue type').fill('Color mismatch');
    await inspector.getByLabel('Severity').selectOption('major');
    await inspector.getByLabel('Description').fill('Color differs from approved sample');
    await inspector.getByRole('button', { name: 'Save issue' }).click();
    await inspector.getByRole('button', { name: 'Submit inspection' }).click();
    const submitted = (await inspector.request.get('/api/erp/qc/inspections?mine=1&status=submitted').then(r => r.json())).inspections;
    const returnedInspection = submitted.find((row: { lot_id: string }) => row.lot_id === secondLotId);
    expect(returnedInspection).toBeTruthy();
    expect((await inspector.request.post('/api/erp/qc/reports/decide', { data: { inspectionId: returnedInspection.id, decision: 'accept' } })).status()).toBe(403);
    expect(await inspector.getByRole('button', { name: /Accept report|Reject report|Adjust stock/ }).count()).toBe(0);

    const supervisorContext = await browser.newContext({ baseURL });
    const supervisor = await supervisorContext.newPage();
    try {
      await signIn(supervisor, 'Saima');
      const accepted = await apiPost(supervisor, '/erp/qc/reports/decide', { inspectionId: acceptedInspection.id, decision: 'accept' });
      expect(accepted.report_status).toBe('accepted');
      const stock = await supervisor.request.get('/api/workspace').then(r => r.json());
      const raw = stock.lots.find((lot: { id: string }) => lot.id === firstLotId);
      expect(raw).toMatchObject({ quality: 'approved', inventory_type: 'raw', source: 'qc_lot' });
      expect(stock.balances.find((balance: { lot_id: string; stage: string }) => balance.lot_id === firstLotId && balance.stage === 'raw').grams).toBe(8000);
      const returned = await apiPost(supervisor, '/erp/qc/reports/decide', { inspectionId: returnedInspection.id, decision: 'reject', reason: 'Please recount this lot and attach a clearer shade comparison.' });
      expect(returned.report_status).toBe('returned');
    } finally { await supervisorContext.close(); }

    await inspector.goto('/#/submissions/returned');
    await expect(inspector.getByText('Please recount this lot and attach a clearer shade comparison.')).toBeVisible();
    const mineAfter = await inspector.request.get('/api/erp/qc/inspections?mine=1&status=submitted').then(r => r.json());
    expect(mineAfter.inspections.find((row: { id: string }) => row.id === returnedInspection.id).report_reason).toContain('Please recount');
  } finally { await inspectorContext.close(); }
});
