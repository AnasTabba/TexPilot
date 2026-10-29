import { test, expect, type Page, type Browser } from '@playwright/test';
import { apiPost, origin, signIn, workspace } from './helpers';

test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });
test.beforeEach(async ({ page }) => { await page.request.post('/__test/reset'); });

const token = (kind: 'BUYER' | 'SUPPLIER') => kind === 'BUYER' ? 'e2e-buyer-portal-token-00000000000000000' : 'e2e-supplier-portal-token-000000000000';
async function buyerRfq(page: Page, active = true, admin = false) {
  const id = crypto.randomUUID();
  const response = await page.request.post('/api/integration/v1/buyers', { headers: { Authorization: `Bearer ${token('BUYER')}` }, data: { id, company: `Buyer ${id.slice(0, 6)}`, contactName: 'Test Contact', email: `${id.slice(0, 8)}@factory.test`, phone: '+923001234567', city: 'Karachi' } });
  expect(response.ok(), await response.text()).toBeTruthy();
  if (active) await apiPost(page, '/erp/sales/buyers/review', { id, status: 'active', version: 1, ...(admin ? { interventionReason: 'Covering sales while the manager is away.' } : {}) });
  const rfqId = crypto.randomUUID();
  const posted = await page.request.post('/api/integration/v1/buyer-rfqs', { headers: { Authorization: `Bearer ${token('BUYER')}` }, data: { id: rfqId, buyerId: id, reference: `BR-${rfqId.slice(0, 6)}`, specifications: 'Combed cotton, 30/1, 180 GSM jersey', quantityMilli: 100000, unit: 'kg', requestedDeliveryAt: Date.now() + 21 * 86400000, paymentTerms: 'Net 30 days after delivery' } });
  expect(posted.ok(), await posted.text()).toBeTruthy();
  return { buyerId: id, rfqId };
}
async function issueInvoice(page: Page, rfqId: string, productId?: string, admin = false) {
  const id = crypto.randomUUID();
  const intervention = admin ? { interventionReason: 'Covering sales while the manager is away.' } : {};
  const quote = await apiPost<{ revision: { id: string } }>(page, '/erp/sales/quotes', { id, poId: rfqId, priceMinor: 125000, specifications: 'Combed cotton, 30/1, 180 GSM jersey', requestedDeliveryAt: Date.now() + 21 * 86400000, paymentTerms: 'Net 30 days after delivery', creditDays: 30, ...(productId ? { productId } : {}), ...intervention });
  await apiPost(page, '/erp/sales/quotes/send', { id: quote.revision.id, ...intervention });
  const overview = await page.request.get('/api/erp/sales');
  const state = await overview.json();
  const rfq = state.rfqs.find((row: { id: string }) => row.id === rfqId);
  const accept = await page.request.post('/api/integration/v1/acceptances', { headers: { Authorization: `Bearer ${token('BUYER')}` }, data: { buyerId: rfq.buyer_id, quotationId: quote.revision.id, version: 1, acceptedBy: 'Test Contact', note: 'Accepted for delivery' } });
  expect(accept.ok(), await accept.text()).toBeTruthy();
  const sale = await apiPost<{ invoice: { id: string; total_minor: number }; order: { id: string } }>(page, '/erp/sales/sales', { id: crypto.randomUUID(), revisionId: quote.revision.id, ...intervention });
  return sale;
}
async function signInAs(browser: Browser, name: string) {
  const context = await browser.newContext({ baseURL: origin, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const page = await context.newPage(); await signIn(page, name); return { context, page };
}

test('a pending buyer is approved, an RFQ is quoted and accepted, then a locked invoice is issued', async ({ page }) => {
  const created = await buyerRfq(page, false);
  await signIn(page, 'Sana'); await page.goto('/#/buyers/pending');
  await page.getByRole('button', { name: new RegExp(`Buyer ${created.buyerId.slice(0, 6)}`) }).click();
  await page.getByRole('button', { name: 'Review buyer', exact: true }).click();
  await page.getByRole('button', { name: 'Approve buyer', exact: true }).click();
  await page.goto(`/#/buyer-rfqs/open/${created.rfqId}`);
  await page.getByRole('button', { name: 'Create quotation', exact: true }).click();
  await page.getByLabel(/Rate per/).fill('1250.00');
  await page.getByLabel('Specifications').fill('Combed cotton, 30/1, 180 GSM jersey');
  await page.getByRole('button', { name: 'Save draft quotation', exact: true }).click();
  const overview = await page.request.get('/api/erp/sales').then(r => r.json());
  const revision = overview.revisions.find((row: { buyer_po_id: string }) => row.buyer_po_id === created.rfqId);
  await page.getByRole('button', { name: 'Send quotation', exact: true }).click();
  await expect(page.getByText('Quotation sent to buyer.')).toBeVisible();
  await expect(page.getByText(/30 days credit/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create quotation', exact: true })).toHaveCount(0);
  const accepted = await page.request.post('/api/integration/v1/acceptances', { headers: { Authorization: `Bearer ${token('BUYER')}` }, data: { buyerId: created.buyerId, quotationId: revision.id, version: 1, acceptedBy: 'Test Contact', note: 'Approved' } });
  expect(accepted.ok(), await accepted.text()).toBeTruthy();
  await page.reload();
  await page.getByRole('button', { name: 'Note sale and issue invoice', exact: true }).click();
  await expect(page).toHaveURL(/#\/invoices/);
  await page.goto('/#/invoices/all');
  await expect(page.getByText('PKR 147,500.00')).toBeVisible();
  await page.getByRole('button', { name: 'Open locked invoice', exact: true }).click();
  const facts = page.locator('.sales-invoice');
  await expect(facts.getByText('GST (18%)')).toBeVisible();
  await expect(facts.getByText('PKR 125,000.00', { exact: true })).toBeVisible();
  await expect(facts.getByText('PKR 22,500.00', { exact: true })).toBeVisible();
  await expect(page.getByText(/^INV-\d{4}-0001$/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Edit invoice|Change payment terms/ })).toHaveCount(0);
});

test('rejecting a buyer needs a reason', async ({ page }) => {
  const created = await buyerRfq(page, false);
  await signIn(page, 'Sana'); await page.goto('/#/buyers/pending');
  await page.getByRole('button', { name: new RegExp(`Buyer ${created.buyerId.slice(0, 6)}`) }).click();
  await page.getByRole('button', { name: 'Review buyer', exact: true }).click();
  await page.getByLabel('Decision').selectOption('rejected');
  const reason = page.getByLabel('Review reason');
  await page.getByRole('button', { name: 'Reject buyer', exact: true }).click();
  await expect.poll(() => reason.evaluate(el => (el as HTMLTextAreaElement).validity.valueMissing)).toBe(true);
  const buyers = await page.request.get('/api/erp/sales').then(r => r.json());
  expect(buyers.buyers.find((b: { id: string }) => b.id === created.buyerId).status).toBe('pending');
  await reason.fill('Documents do not match the company name');
  await page.getByRole('button', { name: 'Reject buyer', exact: true }).click();
  await expect.poll(async () => (await page.request.get('/api/erp/sales').then(r => r.json())).buyers.find((b: { id: string }) => b.id === created.buyerId).status).toBe('rejected');
});

test('a sales stock query is answered by the supervisor and returns to the buyer RFQ', async ({ page, browser }) => {
  await signIn(page, 'Sana'); const { rfqId } = await buyerRfq(page);
  const state = await page.request.get('/api/erp/sales').then(r => r.json());
  const productId = state.products[0].id;
  await page.goto(`/#/buyer-rfqs/open/${rfqId}`);
  await page.getByRole('button', { name: 'Ask supervisor', exact: true }).click();
  await page.getByRole('button', { name: 'Send to supervisor', exact: true }).click();
  await expect(page.getByText('Stock question sent to the supervisor.')).toBeVisible();
  const { context, page: supervisor } = await signInAs(browser, 'Saima');
  try {
    await supervisor.goto('/#/requests');
    await supervisor.getByLabel('Available (kg)').fill('80');
    await supervisor.getByLabel('Answer', { exact: true }).fill('80 kg of finished stock is available.');
    await supervisor.getByRole('button', { name: 'Save answer', exact: true }).click();
    await expect(supervisor.getByText(/80 kg of finished stock is available\./)).toBeVisible();
  } finally { await context.close(); }
  await page.reload(); await expect(page.getByText(/80 kg of finished stock is available\./)).toBeVisible();
  expect(productId).toBeTruthy();
});

test('partial invoice payments move from partially paid to paid', async ({ page }) => {
  await signIn(page, 'Sana'); const { rfqId } = await buyerRfq(page); const invoice = await issueInvoice(page, rfqId);
  await page.goto(`/#/invoices/all/${invoice.invoice.id}`);
  await page.getByRole('button', { name: 'Record payment', exact: true }).click();
  await page.getByLabel(/Amount received/).fill('50000');
  await page.getByRole('button', { name: 'Save payment', exact: true }).click();
  await expect(page.getByText(/partially paid/i)).toBeVisible();
  await page.reload(); await page.getByRole('button', { name: 'Record payment', exact: true }).click();
  await page.getByLabel(/Amount received/).fill('97500');
  await page.getByRole('button', { name: 'Save payment', exact: true }).click();
  await expect(page.getByText(/^paid$/i).first()).toBeVisible();
});

test('sales analytics keeps invoice totals in separate source currency groups', async ({ page }) => {
  await signIn(page, 'Anas');
  const first = await buyerRfq(page, true, true); const pkr = await issueInvoice(page, first.rfqId, undefined, true);
  await apiPost(page, '/erp/sales/credit-notes', { id: crypto.randomUUID(), invoiceId: pkr.invoice.id, amountMinor: pkr.invoice.total_minor, reason: 'Fully credited before currency change', interventionReason: 'Covering sales while the manager is away.' });
  await apiPost(page, '/erp/admin/settings', { key: 'currency', value: 'USD' });
  const second = await buyerRfq(page, true, true); await issueInvoice(page, second.rfqId, undefined, true);
  await page.goto('/#/modules/sales/analytics');
  const tables = page.getByRole('table'); await expect(tables.first().getByText('PKR', { exact: true })).toBeVisible(); await expect(tables.first().getByText('USD', { exact: true })).toBeVisible();
  await expect(tables.first().getByText('PKR 0.00')).toBeVisible(); await expect(tables.first().getByText('USD 147,500.00')).toBeVisible();
});

test('dispatch holds and approvals do not deduct stock until dispatch', async ({ page, browser }) => {
  await signIn(page, 'Sana'); const state = await page.request.get('/api/workspace').then(r => r.json()); const productId = state.products[0].id;
  const saleSetup = await buyerRfq(page); const sale = await issueInvoice(page, saleSetup.rfqId, productId);
  const { context: supervisorContext, page: supervisor } = await signInAs(browser, 'Saima');
  let lotId: string;
  try { lotId = (await apiPost<{ lotId: string }>(supervisor, '/erp/stock/finished', { id: crypto.randomUUID(), productId, batch: `E2E-${crypto.randomUUID().slice(0, 6)}`, grams: 100000 })).lotId; }
  finally { await supervisorContext.close(); }
  const { context, page: dispatch } = await signInAs(browser, 'Danish');
  try {
    const before = await workspace(dispatch); const gramsBefore = before.balances.filter((b: { lot_id: string; stage: string }) => b.lot_id === lotId && b.stage === 'finished').reduce((sum: number, b: { grams: number }) => sum + b.grams, 0);
    await dispatch.goto('/#/new-dispatch'); await dispatch.getByLabel('Confirmed sale').selectOption(sale.order.id); await dispatch.getByLabel('Finished goods batch').selectOption(lotId); await dispatch.getByLabel(/Quantity/).fill('100'); await dispatch.getByRole('button', { name: 'Request approval', exact: true }).click();
    expect((await workspace(dispatch)).balances.find((b: { lot_id: string; stage: string }) => b.lot_id === lotId && b.stage === 'finished')?.grams ?? gramsBefore).toBe(gramsBefore);
    await page.goto('/#/dispatch-requests/pending_approval'); const record = await page.request.get('/api/erp/dispatch').then(r => r.json());
    await page.getByRole('button', { name: 'Review dispatch', exact: true }).click();
    await page.getByRole('button', { name: 'Hold dispatch', exact: true }).click(); await page.getByLabel('Reason').fill('Confirm payment with the buyer first'); await page.getByRole('button', { name: 'Place on hold', exact: true }).click();
    await dispatch.goto('/#/dispatches/on_hold'); const held = record.dispatches[0]; await dispatch.getByRole('button', { name: /Open dispatch/ }).click(); await dispatch.getByRole('button', { name: 'Re-request approval', exact: true }).click();
    await page.reload(); await page.getByRole('button', { name: 'Approve dispatch', exact: true }).click();
    await dispatch.goto('/#/dispatches/all'); await dispatch.getByRole('button', { name: 'Open dispatch' }).click(); await dispatch.getByRole('button', { name: 'Mark dispatched', exact: true }).click();
    await expect(dispatch.getByText('Dispatch recorded; finished stock was deducted.')).toBeVisible();
    const after = await workspace(dispatch); expect(after.balances.filter((b: { lot_id: string; stage: string }) => b.lot_id === lotId && b.stage === 'finished').reduce((sum: number, b: { grams: number }) => sum + b.grams, 0)).toBe(gramsBefore - 100000);
    expect(held.id).toBeTruthy();
  } finally { await context.close(); }
});

test('dispatch stock issues are persisted and visible to the supervisor', async ({ page, browser }) => {
  await signIn(page, 'Sana'); const workspaceBefore = await page.request.get('/api/workspace').then(r => r.json()); const productId = workspaceBefore.products[0].id; const { rfqId } = await buyerRfq(page); const sale = await issueInvoice(page, rfqId, productId);
  const { context: supervisorContext, page: supervisor } = await signInAs(browser, 'Saima');
  let lotId: string, dispatchContext: Awaited<ReturnType<typeof signInAs>>['context'] | undefined;
  try {
    lotId = (await apiPost<{ lotId: string }>(supervisor, '/erp/stock/finished', { id: crypto.randomUUID(), productId, batch: `ISSUE-${crypto.randomUUID().slice(0, 6)}`, grams: 100000 })).lotId;
    const { context, page: dispatch } = await signInAs(browser, 'Danish'); dispatchContext = context;
    const request = await apiPost<{ dispatch: { id: string } }>(dispatch, '/erp/dispatch', { id: crypto.randomUUID(), orderId: sale.order.id, lotId, quantityMilli: 100000, grams: 100000 });
    await dispatch.goto(`/#/dispatches/${request.dispatch.id}`);
    await dispatch.getByText('Raise a stock issue', { exact: true }).click();
    await dispatch.getByLabel('Issue type').selectOption('shortage');
    await dispatch.getByLabel('Difference (kg)').fill('2');
    await dispatch.getByLabel('Describe the mismatch').fill('Physical count is 2 kg below the dispatch record.');
    await dispatch.getByRole('button', { name: 'Send issue to supervisor', exact: true }).click();
    await expect(dispatch.getByText('Stock issue sent to the supervisor.')).toBeVisible();
    const issues = await supervisor.request.get('/api/erp/dispatch/stock-issues'); expect(issues.ok()).toBeTruthy();
    const body = await issues.json(); expect(body.issues.some((issue: { dispatch_id: string; difference_grams: number }) => issue.dispatch_id === request.dispatch.id && issue.difference_grams === 2000)).toBeTruthy();
    const inbox = await supervisor.request.get('/api/erp/notifications').then(r => r.json());
    expect(inbox.notifications.some((notification: { object_type: string; object_id: string }) => notification.object_type === 'stock_issue' && notification.object_id === body.issues[0].id)).toBeTruthy();
    await supervisor.goto('/#/requests/stock-issues');
    await expect(supervisor.getByText(/Physical count is 2 kg below the dispatch record\./)).toBeVisible();
    await dispatch.goto('/#/dispatches'); await expect(dispatch.getByText(/Raw stock cannot be sale-dispatched/)).toHaveCount(0);
  } finally { await supervisorContext.close(); await dispatchContext?.close(); }
});

test('raw, cops and WIP stock is refused in New dispatch', async ({ page, browser }) => {
  await signIn(page, 'Sana'); const { rfqId } = await buyerRfq(page); await issueInvoice(page, rfqId);
  const { context, page: dispatch } = await signInAs(browser, 'Danish');
  try {
    await dispatch.goto('/#/new-dispatch');
    await expect(dispatch.getByText(/Raw stock cannot be sale-dispatched/).first()).toBeVisible();
    // The legacy routes that created raw/cops/WIP stock are retired (Task 21); the API refusal of those stages is covered in tests/dispatch.test.mjs.
    const lots = await dispatch.getByLabel('Finished goods batch').locator('option').allTextContents();
    expect(lots.join('|')).not.toMatch(/· (raw|cops|wip) ·/);
  } finally { await context.close(); }
});
