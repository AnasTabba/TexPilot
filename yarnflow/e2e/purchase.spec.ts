import { test, expect, devices, type Page } from '@playwright/test';
import { origin, signIn } from './helpers';

test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });
test.beforeEach(async ({ page, isMobile }) => { test.skip(isMobile, 'Full purchase workflows run on desktop; mobile has a dedicated layout proof.'); await page.request.post('/__test/reset'); });

const nav = (page: Page, name: RegExp | string) => page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name });
const SUPPLIER_TOKEN = { Authorization: 'Bearer e2e-supplier-portal-token-000000000000' } as const;

/** Register a supplier the way the later portal does: through the supplier-side integration API. */
async function registerSupplier(page: Page, company = 'Pine valley spinning mills') {
  const response = await page.request.post('/api/integration/v1/suppliers', {
    data: { id: crypto.randomUUID(), company, contactName: 'Hamza Desk', email: 'pine@supplier.test', phone: '+92 300 4445555', city: 'Faisalabad', website: '', categories: ['cotton'] },
    headers: SUPPLIER_TOKEN,
  });
  expect(response.status(), await response.text()).toBe(201);
  return ((await response.json()) as { supplier: { id: string } }).supplier.id;
}

/** One bid for the full requested quantity through the same integration API. */
async function submitBid(page: Page, rfqId: string, supplierId: string, priceMinor = 125000) {
  const response = await page.request.post('/api/integration/v1/bids', {
    data: { supplierId, id: crypto.randomUUID(), rfqId, version: 0, quantityMilli: 100000, priceMinor, currency: 'PKR', paymentTerms: '30 days after confirmed delivery', deliveryAt: Date.now() + 7 * 86400000, validUntil: Date.now() + 3 * 86400000, note: 'Freight included' },
    headers: SUPPLIER_TOKEN,
  });
  expect(response.status(), await response.text()).toBe(201);
}

async function approveSupplier(page: Page) {
  await nav(page, /^Suppliers/).click();
  await page.getByLabel('Status', { exact: true }).selectOption('pending');
  await page.getByRole('button', { name: 'Review supplier access' }).click();
  await page.getByLabel('Verification details / reason', { exact: true }).fill('Contacted the company and checked its cotton licence');
  await page.getByRole('checkbox', { name: 'I verified the company' }).check();
  await page.getByRole('button', { name: 'Save decision' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Decision saved' })).toBeVisible();
  await expect(page.getByText('No pending supplier registrations.')).toBeVisible();
}

async function createRfq(page: Page) {
  await nav(page, /^RFQs/).click();
  await page.getByRole('button', { name: 'New RFQ' }).click();
  await page.getByLabel('RFQ title', { exact: true }).fill('Cotton 30/1 trial order');
  await page.getByLabel('Specifications (count, composition, quality)', { exact: true }).fill('Combed ring-spun cotton, count 30/1, freight included');
  await page.getByLabel('Required quantity', { exact: true }).fill('100');
  await page.getByLabel('Delivery location', { exact: true }).fill('FAZ Textile Factory Karachi');
  await page.getByRole('button', { name: 'Save draft RFQ' }).click();
  await page.getByRole('checkbox', { name: 'I checked the specifications' }).check();
  await page.getByRole('button', { name: 'Publish RFQ', exact: true }).click();
  await expect(page.getByText('1 supplier portal recipients')).toBeVisible();
  return ((await (await page.request.get('/api/erp/procurement')).json()) as { rfqs: { id: string }[] }).rfqs[0].id;
}

async function openRfqDetail(page: Page) {
  await page.getByRole('button', { name: 'Refresh' }).click();
  await page.getByRole('button', { name: 'Open RFQ' }).click();
  await expect(page.getByRole('heading', { name: 'Bid comparison' })).toBeVisible();
}

async function acceptWinningBid(page: Page) {
  await page.getByRole('button', { name: 'Review and accept bid' }).click();
  await page.getByRole('checkbox', { name: 'I accept this bid revision' }).check();
  await page.getByRole('button', { name: 'Accept and create purchase order' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Purchase order created' })).toBeVisible();
}

async function attachBillOfLading(page: Page) {
  await nav(page, /^Orders/).click();
  await page.getByRole('button', { name: 'Attach bill of lading' }).click();
  await page.getByLabel('Bill of lading number', { exact: true }).fill('TESTBOL-1001');
  await page.getByRole('button', { name: 'Save bill of lading' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Bill of lading attached.' })).toBeVisible();
}

/** supplier → Pervaiz approves → RFQ → bid → PO, all through the new screens where the PM decides. */
async function pipeline(page: Page, priceMinor = 125000) {
  const supplierId = await registerSupplier(page);
  await signIn(page, 'Pervaiz');
  await approveSupplier(page);
  const rfqId = await createRfq(page);
  await submitBid(page, rfqId, supplierId, priceMinor);
  await openRfqDetail(page);
  await acceptWinningBid(page);
  return { supplierId, rfqId };
}

test('a registered supplier is approved and an RFQ runs from bidding to a purchase order', async ({ page }) => {
  await pipeline(page);
  await expect(page.getByText('PKR 1,250.00 / kg')).toBeVisible();

  // The accepted bid becomes a purchase order with its recorded total.
  await nav(page, /^Orders/).click();
  await expect(page.getByText('PKR 125,000.00')).toBeVisible();
  await expect(page.getByText('Pine valley spinning mills')).toBeVisible();
  await expect(page.getByText('PKR 125,000.00')).toBeVisible();

  // The supplier directory opens a profile with the recorded rating history and a rate form.
  await nav(page, /^Suppliers/).click();
  await page.getByRole('button', { name: 'Open profile' }).click();
  await expect(page.getByText('Pine valley spinning mills').first()).toBeVisible();
  await expect(page.getByText('No settled lots yet', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Rate supplier' }).click();
  await page.getByLabel('Rating', { exact: true }).selectOption('4');
  await page.getByLabel('Feedback (optional)', { exact: true }).fill('Delivered the trial run on time');
  await page.getByRole('button', { name: 'Save rating' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Rating saved' })).toBeVisible();
  await expect(page.getByText(/4 \/ 5/).first()).toBeVisible();

  // Urdu, and no horizontal overflow on either PM page.
  await nav(page, /^My profile/).click();
  await page.getByRole('button', { name: /Switch language to Urdu/ }).click();
  await page.goto(origin + '/#/suppliers');
  await expect(page.getByRole('heading', { level: 1, name: 'سپلائرز', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.goto(origin + '/#/orders');
  await expect(page.getByRole('heading', { level: 1, name: 'آرڈر' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test('rejecting a supplier or a bid needs a reason', async ({ page }) => {
  const rejected = await registerSupplier(page, 'Unverifiable palm oil mill');
  await signIn(page, 'Pervaiz');
  await nav(page, /^Suppliers/).click();
  await page.getByLabel('Status', { exact: true }).selectOption('pending');
  await page.locator('article', { hasText: 'Unverifiable palm oil mill' }).getByRole('button', { name: 'Review supplier access' }).click();
  await page.getByLabel('Decision', { exact: true }).selectOption({ label: 'Reject registration' });
  await page.getByRole('button', { name: 'Save decision' }).click();
  await expect(page.locator('.live-field-error').first()).toBeVisible();
  await page.getByLabel('Verification details / reason', { exact: true }).fill('Company documents did not check out');
  await page.getByRole('button', { name: 'Save decision' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Decision saved' })).toBeVisible();
  await page.getByLabel('Status', { exact: true }).selectOption('all');
  await expect(page.locator('article', { hasText: 'Unverifiable palm oil mill' }).locator('.yf-status').filter({ hasText: 'Rejected' })).toBeVisible();

  // A rejected supplier cannot bid, so a second supplier is approved to test the bid rejection.
  const bidder = await registerSupplier(page, 'Reliable cotton mills');
  const pending = (await (await page.request.get('/api/erp/suppliers?status=pending')).json()) as { suppliers: { id: string; version: number }[] };
  const mine = pending.suppliers.find(supplier => supplier.id === bidder)!;
  expect((await page.request.post('/api/erp/suppliers/review', { data: { id: bidder, status: 'approved', version: mine.version, reason: 'Approved to test bid rejection' }, headers: { Origin: origin } })).ok()).toBeTruthy();
  const rfqId = await createRfq(page);
  await submitBid(page, rfqId, bidder);
  await openRfqDetail(page);
  await page.getByRole('button', { name: 'Reject bid', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm rejection' }).click();
  await expect(page.locator('.live-field-error').first()).toBeVisible();
  await page.getByLabel('Rejection reason', { exact: true }).fill('Delivery date missed the production window');
  await page.getByRole('button', { name: 'Confirm rejection' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Bid rejected' })).toBeVisible();
  await expect(page.getByText('Rejected:', { exact: false }).first()).toBeVisible();
  expect(rejected).toBeTruthy();
});

test('shipment tracking without a configured provider shows a message, not a broken page', async ({ page }) => {
  await pipeline(page);
  await attachBillOfLading(page);
  await nav(page, /^Orders/).click();
  await page.getByRole('group', { name: 'Purchase order views' }).getByRole('button', { name: 'Tracking' }).click();
  await expect(page.getByLabel('Find a shipment', { exact: true })).toBeVisible();
  await expect(page.getByText('TESTBOL-1001')).toBeVisible();
  // A B/L that matches nothing says so honestly.
  await page.getByLabel('Find a shipment', { exact: true }).fill('MSCUBL1234');
  await expect(page.getByText('No shipment carries that bill of lading yet.')).toBeVisible();
  // Tracking the known B/L reports the missing configuration instead of breaking the page.
  await page.getByLabel('Find a shipment', { exact: true }).fill('TESTBOL-1001');
  await page.getByRole('button', { name: 'Track shipment' }).click();
  await expect(page.getByRole('alert')).toContainText('Tracking is not configured: API key missing.');
  await page.getByRole('group', { name: 'Purchase order views' }).getByRole('button', { name: 'Orders' }).click();
  await expect(page.getByText('Pine valley spinning mills')).toBeVisible();
});

test('the PM records an arrived lot against the PO and the inspector is told', async ({ page, browser, baseURL }, info) => {
  await pipeline(page);
  await attachBillOfLading(page);
  await page.getByRole('button', { name: 'Record arrived lot' }).click();
  await expect(page.getByText('Add the material in Stock', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'Register arrival', exact: true }).click();
  await page.getByLabel('Lot reference', { exact: true }).fill('ERP-RCV-001');
  await page.getByLabel('Supplier lot reference (optional)', { exact: true }).fill('SUP-LOT-001');
  await page.getByRole('button', { name: 'Register arrival for inspection' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Arrival registered. Quality inspectors have been told it is ready to inspect.' })).toBeVisible();
  await expect(page.getByText('ERP-RCV-001 ·').first()).toBeVisible();
  await expect(page.getByText('Awaiting inspection').first()).toBeVisible();
  // Registering an arrival adds nothing to stock: the inspector's report, then the supervisor, decide that.
  const snapshot = (await (await page.request.get('/api/workspace')).json()) as { lots: { batch: string }[] };
  expect(snapshot.lots.some(lot => lot.batch === 'ERP-RCV-001')).toBe(false);

  const inspectorContext = await browser.newContext({ ...(info.project.name.includes('webkit') ? devices['iPhone 13'] : devices['Desktop Chrome']), baseURL, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const inspector = await inspectorContext.newPage();
  try {
    await signIn(inspector, 'Qasim');
    const bell = inspector.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: /^Notifications/ });
    await expect(bell.locator('.yf-nav-count')).toHaveText('1');
    await bell.click();
    await inspector.getByRole('button', { name: /Lot ready for inspection/ }).click();
    await expect(inspector.getByRole('heading', { level: 1, name: 'Lots', exact: true })).toBeVisible();
    await expect(inspector.getByText('ERP-RCV-001 ·').first()).toBeVisible();
  } finally { await inspectorContext.close(); }
});

test('claim notices are read-only for the purchase manager', async ({ page }) => {
  expect((await page.request.post('/__test/notify', { data: { role: 'purchase_manager', event: 'claim.created', objectType: 'claim', objectId: crypto.randomUUID(), label: 'LOT-001 shade claim' } })).ok()).toBeTruthy();
  await signIn(page, 'Pervaiz');
  await nav(page, /^Notifications/).click();
  await page.getByRole('button', { name: /Claim raised/ }).click();
  await expect(page).toHaveURL(/#\/claims\//);
  await expect(page.getByRole('heading', { level: 1, name: 'Claims', exact: true })).toBeVisible();
  await expect(page.getByText('Read only.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Decide claim' })).toHaveCount(0);
  // The Purchasing manager can never reach the deciding API either.
  const response = await page.request.post('/api/erp/qc/claims/decide', { data: { id: crypto.randomUUID(), outcome: 'claim' }, headers: { Origin: origin } });
  expect(response.status()).toBe(403);

  await nav(page, /^My profile/).click();
  await page.getByRole('button', { name: /Switch language to Urdu/ }).click();
  await page.goto(origin + '/#/claims');
  await expect(page.getByRole('heading', { level: 1, name: 'دعوے', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test('an admin opening a supplier notification lands on the purchase module supplier profile', async ({ page }) => {
  const supplierId = crypto.randomUUID();
  expect((await page.request.post('/__test/notify', { data: { role: 'admin', event: 'supplier.pending', objectType: 'supplier', objectId: supplierId, label: 'Noor Spinning' } })).ok()).toBeTruthy();
  await signIn(page, 'Anas');
  await page.goto('/#/notifications');
  await page.getByRole('button', { name: /New supplier pending/ }).click();
  await expect(page).toHaveURL(new RegExp(`#\\/modules\\/purchase\\/suppliers\\/${supplierId}$`));
});
