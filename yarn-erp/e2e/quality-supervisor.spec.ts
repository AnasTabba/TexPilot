import { test, expect } from '@playwright/test';
import { apiPost, origin, seedQcLots, signIn, workspace } from './helpers';

test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });
test.beforeEach(async ({ page, isMobile }) => { test.skip(isMobile, 'Desktop navigation workflow; phone navigation is covered by roles.spec.'); await page.request.post('/__test/reset'); });

test('the supervisor answers a stock query and submits a flagged report snapshot', async ({ page, browser }) => {
  const salesContext = await browser.newContext({ baseURL: origin, serviceWorkers: 'block' });
  const sales = await salesContext.newPage();
  try {
    await signIn(sales, 'Sana');
    const state = await workspace(sales);
    const queryId = crypto.randomUUID(), question = 'Can we supply the next order from this batch?';
    await apiPost(sales, '/erp/stock/queries', { id: queryId, productId: state.products[0].id, quantityMilli: 2500, question });

    await signIn(page, 'Saima');
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    for (const label of ['Dashboard', 'Reviews', 'Inventory', 'Requests', 'Report', 'History']) await expect(nav.getByRole('button', { name: new RegExp(`^${label}`) })).toBeVisible();
    await nav.getByRole('button', { name: /^Requests/ }).click();
    const query = page.locator(`[id="${queryId}"]`);
    await expect(query.getByText(question)).toBeVisible();
    await query.getByLabel('Available (kg)', { exact: true }).fill('80');
    await query.getByLabel('Answer', { exact: true }).fill('Available in bay 3.');
    await query.getByRole('button', { name: 'Save answer', exact: true }).click();
    await expect(query).toContainText('80 kg');
    await expect(query).toContainText('Available in bay 3.');
    const answered = (await (await sales.request.get('/api/erp/stock/queries')).json()).queries.find((item: { id: string }) => item.id === queryId);
    expect(answered).toMatchObject({ status: 'answered', available_grams: 80000, answer: 'Available in bay 3.' });

    const lot = state.lots.find((row: { batch: string }) => row.batch === 'LOT-1024');
    expect(lot).toBeTruthy();
    await nav.getByRole('button', { name: /^Inventory/ }).click();
    const adjustment = page.locator('form[aria-label="Adjust stock"]');
    await adjustment.getByLabel('Batch', { exact: true }).selectOption(lot.id);
    await adjustment.getByLabel('Change', { exact: true }).selectOption({ label: 'Correction: add stock' });
    await adjustment.getByLabel('Weight (kg)', { exact: true }).fill('0.100');
    await adjustment.getByLabel('Reason', { exact: true }).fill('Cycle count correction');
    await adjustment.getByRole('button', { name: 'Save adjustment', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Stock adjustment recorded.' })).toBeVisible();

    await nav.getByRole('button', { name: /^Report/ }).click();
    await page.getByRole('button', { name: 'Preview period', exact: true }).click();
    await expect(page.getByText(/Inventory adjustments · 1/)).toBeVisible();
    await page.getByRole('checkbox', { name: 'Flag for admin', exact: true }).check();
    await page.getByLabel('Flag note', { exact: true }).fill('Review cycle count before reorder');
    await page.getByLabel('Note to admin (optional)', { exact: true }).fill('Stock reconciled this month.');
    await page.getByRole('button', { name: 'Submit report', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Report submitted and saved.' })).toBeVisible();
    const saved = (await (await page.request.get('/api/erp/stock/reports')).json()).reports;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ created_by_name: 'Saima', note: 'Stock reconciled this month.', flagged: [{ objectType: 'adjustment', note: 'Review cycle count before reorder' }] });

    await page.goto('/#/report');
    await expect(page.getByText('Review cycle count before reorder')).toBeVisible();
    await expect(page.getByText('Stock reconciled this month.', { exact: true })).toBeVisible();
    expect((await (await page.request.get('/api/erp/stock/reports')).json()).reports).toHaveLength(1);
  } finally { await salesContext.close(); }
});

test('dispatch issues use both gate previews and adjustments at threshold wait for admin', async ({ page, browser }) => {
  await signIn(page, 'Anas');
  await apiPost(page, '/erp/admin/thresholds', { type: 'dispatch_stock_issue', value: 5000 });
  await apiPost(page, '/erp/admin/thresholds', { type: 'inventory_adjustment', value: 500 });
  const state = await workspace(page), lot = state.lots.find((row: { batch: string }) => row.batch === 'LOT-1024');
  expect(lot).toBeTruthy();
  const stockBefore = state.balances.find((row: { lot_id: string; stage: string }) => row.lot_id === lot.id && row.stage === 'finished')!.grams;

  const dispatchContext = await browser.newContext({ baseURL: origin, serviceWorkers: 'block' });
  try {
    const dispatch = await dispatchContext.newPage();
    await signIn(dispatch, 'Danish');
    const rejectedId = crypto.randomUUID(), gatedId = crypto.randomUUID();
    await apiPost(dispatch, '/erp/dispatch/stock-issues', { id: rejectedId, lotId: lot.id, stage: 'finished', kind: 'mismatch', differenceGrams: 1000, description: 'The shelf count did not match the label.' });
    await apiPost(dispatch, '/erp/dispatch/stock-issues', { id: gatedId, lotId: lot.id, stage: 'finished', kind: 'shortage', differenceGrams: 5000, description: 'The reserve is short by five kilograms.' });

    const supervisorContext = await browser.newContext({ baseURL: origin, serviceWorkers: 'block' });
    const supervisor = await supervisorContext.newPage();
    await signIn(supervisor, 'Saima');
    await supervisor.goto('/#/notifications');
    const issueNotice = supervisor.getByRole('button', { name: /Stock issue raised/ }).first();
    await expect(issueNotice).toBeVisible();
    await issueNotice.click();
    await expect(supervisor).toHaveURL(new RegExp(`/requests/stock-issues/${gatedId}$`));
    const gatedIssue = supervisor.locator(`[id="${gatedId}"]`);
    await expect(gatedIssue).toBeVisible();
    await expect(gatedIssue.getByText(/5 kg against 5 kg.*admin approval required/)).toBeVisible();
    await gatedIssue.getByLabel('Correction (kg, optional)', { exact: true }).fill('0.500');
    await expect(gatedIssue.getByText(/0.5 kg against 0.5 kg.*admin approval required/)).toBeVisible();
    await gatedIssue.getByLabel('Decision reason', { exact: true }).fill('Correct the short count in the register.');
    await gatedIssue.getByRole('button', { name: 'Accept', exact: true }).click();
    await expect(gatedIssue).toContainText('pending approval');
    await expect(supervisor.getByRole('status').filter({ hasText: 'waiting for admin approval' })).toBeVisible();

    const rejectedIssue = supervisor.locator(`[id="${rejectedId}"]`);
    await rejectedIssue.getByLabel('Decision reason', { exact: true }).fill('The recount confirmed this was a label mismatch.');
    await rejectedIssue.getByRole('button', { name: 'Reject', exact: true }).click();
    await expect(rejectedIssue).toContainText(/rejected/i);
    const issues = (await (await supervisor.request.get('/api/erp/dispatch/stock-issues')).json()).issues;
    expect(issues.find((row: { id: string }) => row.id === gatedId).status).toBe('pending_approval');
    expect(issues.find((row: { id: string }) => row.id === rejectedId).status).toBe('rejected');

    await supervisor.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: /^Inventory/ }).click();
    const adjustment = supervisor.locator('form[aria-label="Adjust stock"]');
    await adjustment.getByLabel('Batch', { exact: true }).selectOption(lot.id);
    await adjustment.getByLabel('Weight (kg)', { exact: true }).fill('0.500');
    await adjustment.getByLabel('Reason', { exact: true }).fill('Water damage in bay 3.');
    await expect(adjustment.getByText(/0.5 kg against 0.5 kg.*admin approval required/)).toBeVisible();
    await adjustment.getByRole('button', { name: 'Save adjustment', exact: true }).click();
    await expect(supervisor.getByRole('status').filter({ hasText: 'Sent to the admin for approval. Stock has not changed.' })).toBeVisible();
    const after = await workspace(supervisor);
    expect(after.balances.find((row: { lot_id: string; stage: string }) => row.lot_id === lot.id && row.stage === 'finished')!.grams).toBe(stockBefore);
    await supervisorContext.close();
  } finally { await dispatchContext.close(); }
});

test('the supervisor reviews a submitted inspection report with its photo evidence', async ({ page, browser }) => {
  await signIn(page, 'Anas');
  const reference = `SUPERVISOR-QC-${crypto.randomUUID().slice(0, 8)}`;
  const { lots } = await seedQcLots(page, [reference]);
  const lotId = lots[0].id, inspectionId = crypto.randomUUID();
  const inspectorContext = await browser.newContext({ baseURL: origin, serviceWorkers: 'block' });
  const supervisorContext = await browser.newContext({ baseURL: origin, serviceWorkers: 'block' });
  try {
    const inspector = await inspectorContext.newPage();
    await signIn(inspector, 'Qasim');
    await apiPost(inspector, '/erp/qc/inspections', { id: inspectionId, lotId, acceptedMilli: 2000, rejectedMilli: 0, note: 'Two kilograms are ready for acceptance.' });
    const photo = await inspector.request.post('/api/erp/qc/photos', { headers: { Origin: origin }, multipart: {
      id: crypto.randomUUID(), inspectionId,
      photo: { name: 'accepted-stock.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]) },
    } });
    expect(photo.status(), await photo.text()).toBe(201);
    await apiPost(inspector, '/erp/qc/inspections/submit', { id: inspectionId });

    const supervisor = await supervisorContext.newPage();
    await signIn(supervisor, 'Saima');
    await expect(supervisor.getByRole('heading', { name: 'Next: Review an inspector report' })).toBeVisible();
    await supervisor.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(supervisor).toHaveURL(new RegExp(`/reviews/reports/${inspectionId}$`));
    await expect(supervisor.getByRole('heading', { name: new RegExp(reference) })).toBeVisible();
    await expect(supervisor.getByRole('img', { name: /^Photo taken/ })).toBeVisible();
    await supervisor.getByRole('button', { name: 'Accept report', exact: true }).click();
    await expect(supervisor.getByRole('status').filter({ hasText: 'Report accepted.' })).toBeVisible();
    const after = await workspace(supervisor);
    const acceptedLot = after.lots.find((row: { id: string }) => row.id === lotId);
    expect(acceptedLot).toMatchObject({ batch: reference, quality: 'approved', inventory_type: 'raw', source: 'qc_lot' });
    expect(after.balances.find((row: { lot_id: string; stage: string }) => row.lot_id === lotId && row.stage === 'raw')?.grams).toBe(2000);
  } finally {
    await supervisorContext.close();
    await inspectorContext.close();
  }
});
