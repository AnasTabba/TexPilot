import { test, expect, devices } from '@playwright/test';
import { origin, signIn } from './helpers';
test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });
test.beforeEach(async ({ page }) => { await page.request.post('/__test/reset'); });

test('supplier registers, admin approves, RFQ is bid and awarded, and supplier records its B/L', async ({ page, browser, baseURL }, info) => {
 const supplierContext = await browser.newContext({ ...(info.project.name.includes('webkit') ? devices['iPhone 13'] : devices['Desktop Chrome']), baseURL, serviceWorkers: 'block', reducedMotion: 'reduce' });
 const supplier = await supplierContext.newPage();
 try {
  await supplier.goto('/#/supplier');
  await supplier.getByRole('button', { name: 'Register company', exact: true }).click();
  await supplier.getByLabel('Company name', { exact: true }).fill('Test supplier mill');
  await supplier.getByLabel('Contact name', { exact: true }).fill('Supplier Contact');
  await supplier.getByLabel('Email', { exact: true }).fill('supplier@factory.test');
  await supplier.getByLabel('Phone with country code').fill('+923001234567');
  await supplier.getByRole('checkbox', { name: 'Pure Cotton', exact: true }).check();
  await supplier.getByLabel('Choose password').fill('Secure supplier password 2026');
  await supplier.getByLabel('Repeat password').fill('Secure supplier password 2026');
  await supplier.getByRole('button', { name: 'Request approval', exact: true }).click();
  await expect(supplier.getByRole('status').filter({ hasText: 'Registration saved' })).toBeVisible();
  const supplierLogin = async () => {
   await supplier.getByLabel('Email', { exact: true }).fill('supplier@factory.test');
   await supplier.getByLabel('Password', { exact: true }).fill('Secure supplier password 2026');
   await supplier.getByRole('button', { name: 'Sign in', exact: true }).click();
  };
  await supplierLogin();
  await expect(supplier.getByRole('heading', { name: 'Waiting for admin approval' })).toBeVisible();
  await page.goto('/');
  await page.getByRole('button', { name: 'Anas', exact: true }).click();
  await page.getByLabel('4-digit PIN', { exact: true }).fill('2468');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await page.goto('/#/procurement');
  await page.getByRole('button', { name: 'Review supplier access', exact: true }).click();
  await page.getByLabel('Verification details / reason').fill('Contacted the supplier and checked company identity');
  await page.getByLabel('Intervention reason').fill('Purchase manager not set up yet');
  await page.getByRole('checkbox', { name: 'I verified the company' }).check();
  await page.getByRole('button', { name: 'Save decision' }).click();
  await expect(page.locator('.erp-status').filter({ hasText: /^approved$/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Call.*923001234567/ })).toHaveAttribute('href', 'tel:+923001234567');
  await page.getByRole('button', { name: 'RFQs and bids', exact: true }).click();
  await page.getByRole('button', { name: 'New RFQ', exact: true }).click();
  await page.getByLabel('RFQ title', { exact: true }).fill('Cotton 30/1 trial order');
  await page.getByLabel('Specifications (count, composition, quality)', { exact: true }).fill('Combed ring-spun cotton, count 30/1, freight included');
  await page.getByLabel('Required quantity', { exact: true }).fill('100');
  await page.getByLabel('Delivery location', { exact: true }).fill('FAZ Textile Factory Karachi');
  await page.getByLabel('Intervention reason').fill('Purchase manager not set up yet');
  await page.getByRole('button', { name: 'Save draft RFQ' }).click();
  await page.getByRole('checkbox', { name: 'I checked the specifications' }).check();
  await page.getByLabel('Intervention reason').fill('Purchase manager not set up yet');
  await page.getByRole('button', { name: 'Publish RFQ', exact: true }).click();
  await expect(page.getByText('1 supplier portal recipients')).toBeVisible();
  await supplier.reload(); await supplierLogin();
  await supplier.getByRole('button', { name: 'Submit your bid', exact: true }).click();
  await supplier.getByLabel('Rate per kg', { exact: true }).fill('1250.50');
  await supplier.getByLabel('Payment terms', { exact: true }).fill('30 days after delivery; freight and taxes included');
  await supplier.getByRole('button', { name: 'Submit bid', exact: true }).click();
  await expect(supplier.getByRole('button', { name: 'Revise your bid' })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('button', { name: 'Review and accept bid' }).click();
  await page.getByRole('checkbox', { name: 'I accept this bid revision' }).check();
  await page.getByLabel('Intervention reason').fill('Purchase manager not set up yet');
  await page.getByRole('button', { name: 'Accept and create purchase order' }).click();
  await expect(page.locator('.erp-status').filter({ hasText: /^awarded$/ })).toBeVisible();
  await supplier.getByRole('button', { name: 'Refresh', exact: true }).click();
  await supplier.getByRole('button', { name: 'Record dispatch and B/L' }).click();
  await supplier.getByLabel('Bill of lading number', { exact: true }).fill('TESTBOL-1001');
  await supplier.getByLabel('Shipping carrier', { exact: true }).fill('Test carrier');
  await supplier.getByRole('button', { name: 'Save dispatch notice' }).click();
  await expect(supplier.getByText('Bill of lading: TESTBOL-1001')).toBeVisible();
  await page.getByRole('button', { name: 'Purchase orders', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByText('Bill of lading: TESTBOL-1001')).toBeVisible();
  await expect(page.getByText('Tracking is not connected.', { exact: false })).toBeVisible();
  // The purchase manager attaches the B/L to the PO (admin steps in here), then registers the arrival against that shipment.
  const inbound = await (await page.request.get('/api/erp/inbound')).json();
  const attached = await page.request.post('/api/erp/shipments', { data: { id: crypto.randomUUID(), orderId: inbound.orders[0].id, billOfLading: 'TESTBOL-1001', interventionReason: 'Purchase manager not set up yet' }, headers: { Origin: origin } });
  expect(attached.ok(), await attached.text()).toBeTruthy();
  await page.getByRole('button', { name: 'Incoming stock', exact: true }).click();
  await page.getByRole('button', { name: 'Register arrival', exact: true }).click();
  await page.getByLabel('Lot reference', { exact: true }).fill('ERP-RCV-001');
  await page.getByLabel('Supplier lot reference (optional)', { exact: true }).fill('SUP-LOT-001');
  await page.getByLabel('Intervention reason').fill('Purchase manager not set up yet');
  await page.getByRole('button', { name: 'Register arrival for inspection', exact: true }).click();
  await expect(page.getByText('ERP-RCV-001 ·').first()).toBeVisible();
  await expect(page.getByText('Awaiting inspection').first()).toBeVisible();
  // Registering an arrival adds nothing to stock: the inspector's report, then the supervisor, decide that.
  const snapshot = await (await page.request.get('/api/workspace')).json();
  expect(snapshot.lots.some((lot: { batch: string }) => lot.batch === 'ERP-RCV-001')).toBe(false);
  expect(snapshot.movements.some((m: { action: string; note: string }) => m.action === 'receive' && m.note.includes('PO-'))).toBe(false);

  // The quality inspector counts the lot, photographs the accepted part, describes the rejected part and submits.
  const inspectorContext = await browser.newContext({ ...(info.project.name.includes('webkit') ? devices['iPhone 13'] : devices['Desktop Chrome']), baseURL, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const inspector = await inspectorContext.newPage();
  try {
   await signIn(inspector, 'Qasim');
   await inspector.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: /^Inspections/ }).click();
   await expect(inspector.getByRole('heading', { level: 1, name: 'Inspections', exact: true })).toBeVisible();
   await expect(inspector.getByText('ERP-RCV-001 ·').first()).toBeVisible();
   await inspector.getByRole('button', { name: 'Record inspection', exact: true }).click();
   await inspector.getByLabel('Accepted quantity (kg)', { exact: true }).fill('8');
   await inspector.getByLabel('Rejected quantity (kg)', { exact: true }).fill('2');
   await inspector.getByRole('button', { name: 'Save draft', exact: true }).click();
   await expect(inspector.getByRole('status').filter({ hasText: 'Draft saved' })).toBeVisible();
   await inspector.getByRole('button', { name: 'Submit inspection', exact: true }).click();
   await expect(inspector.getByRole('alert').filter({ hasText: 'Upload at least one photo of the accepted quantity.' })).toBeVisible();
   const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
   await inspector.getByLabel('Photo of the accepted quantity').setInputFiles({ name: 'cones.jpg', mimeType: 'image/jpeg', buffer: jpeg });
   await expect(inspector.getByRole('img', { name: /^Photo taken/ })).toBeVisible();
   await inspector.getByRole('button', { name: 'Submit inspection', exact: true }).click();
   await expect(inspector.getByRole('alert').filter({ hasText: 'Describe at least one issue for the rejected quantity.' })).toBeVisible();
   await inspector.getByRole('button', { name: 'Add an issue', exact: true }).click();
   await inspector.getByLabel('Issue type', { exact: true }).fill('Shade variation');
   await inspector.getByLabel('Severity', { exact: true }).selectOption('major');
   await inspector.getByLabel('Description', { exact: true }).fill('Dye lot differs from the approved sample');
   await inspector.getByRole('button', { name: 'Save issue', exact: true }).click();
   await inspector.getByRole('button', { name: 'Submit inspection', exact: true }).click();
   await expect(inspector.getByRole('status').filter({ hasText: 'Inspection submitted' })).toBeVisible();
   await expect(inspector.getByText('waiting for the supervisor').first()).toBeVisible();
   expect(await inspector.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
   const mine = await (await inspector.request.get('/api/erp/qc/inspections?mine=1&status=submitted')).json();
   expect(mine.inspections).toHaveLength(1); expect(mine.inspections[0].photos).toHaveLength(1);
  } finally { await inspectorContext.close(); }

  // The supervisor accepts the report: only now does the accepted quantity become QC-approved raw stock. Confirming the rejection raises a claim.
  const supervisorContext = await browser.newContext({ ...(info.project.name.includes('webkit') ? devices['iPhone 13'] : devices['Desktop Chrome']), baseURL, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const supervisor = await supervisorContext.newPage();
  try {
   await signIn(supervisor, 'Saima');
   await supervisor.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: /^Review/ }).click();
   await expect(supervisor.getByRole('heading', { level: 1, name: 'Review', exact: true })).toBeVisible();
   await supervisor.getByRole('button', { name: 'Accept report', exact: true }).click();
   await expect(supervisor.getByRole('status').filter({ hasText: 'Report accepted' })).toBeVisible();
   const stock = await (await supervisor.request.get('/api/workspace')).json();
   const received = stock.lots.find((lot: { batch: string }) => lot.batch === 'ERP-RCV-001');
   expect(received.quality).toBe('approved');
   expect(stock.balances.find((b: { lot_id: string; stage: string }) => b.lot_id === received.id && b.stage === 'raw').grams).toBe(8000);
   await supervisor.getByRole('button', { name: 'Confirm rejection', exact: true }).click();
   await expect(supervisor.getByRole('status').filter({ hasText: 'Rejection confirmed' })).toBeVisible();
   const claims = await (await page.request.get('/api/erp/qc/claims')).json();
   expect(claims.claims).toHaveLength(1); expect(claims.claims[0]).toMatchObject({ rejected_milli: 2000, status: 'open' });
   expect(await supervisor.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  } finally { await supervisorContext.close(); }
  for (const p of [page, supplier]) expect(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
 } finally { await supplierContext.close(); }
});

test('supplier register and login forms support Urdu without horizontal overflow', async ({ page }) => {
 await page.goto('/#/supplier');
 await page.getByRole('button', { name: /Switch language to Urdu/ }).click();
 await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
 await page.getByRole('button', { name: 'کمپنی رجسٹر کریں', exact: true }).click();
 await expect(page.getByLabel('کمپنی کا نام', { exact: true })).toBeVisible();
 expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test('admin legacy purchasing forms require intervention on every mutation, and a large award waits for approval', async ({ page }) => {
 await signIn(page);
 const post = async (path: string, data: object) => { const r = await page.request.post('/api' + path, { data, headers: { Origin: origin } }); return { status: r.status(), body: await r.json() }; };
 const supplierPassword = 'Secure supplier password 2026';
 expect((await post('/portal/register', { company: 'Gate mill', contactName: 'Gate Contact', email: 'gate@factory.test', phone: '+923001234567', categories: ['cotton'], password: supplierPassword })).status).toBe(201);
 const suppliers = await (await page.request.get('/api/erp/suppliers?status=pending')).json();
 expect((await post('/erp/suppliers/review', { id: suppliers.suppliers[0].id, version: 1, status: 'approved', reason: 'Company checked', interventionReason: 'Purchase manager not set up yet' })).status).toBe(200);
 expect((await post('/erp/admin/thresholds', { type: 'purchase', value: 1, interventionReason: 'Test the approval gate' })).status).toBe(200);
 await page.goto('/#/procurement');
 await page.getByRole('button', { name: 'RFQs and bids', exact: true }).click();
 await page.getByRole('button', { name: 'New RFQ', exact: true }).click();
 await page.getByLabel('RFQ title', { exact: true }).fill('Gate cotton order');
 await page.getByLabel('Specifications (count, composition, quality)', { exact: true }).fill('Combed cotton 20/1 for the gate test');
 await page.getByLabel('Required quantity', { exact: true }).fill('10');
 await page.getByLabel('Delivery location', { exact: true }).fill('FAZ Textile Factory');
 await page.getByRole('button', { name: 'Save draft RFQ' }).click();
 expect((await (await page.request.get('/api/erp/procurement')).json()).rfqs).toHaveLength(0);
 await page.getByLabel('Intervention reason').fill('Purchase manager not set up yet');
 await page.getByRole('button', { name: 'Save draft RFQ' }).click();
 await expect(page.getByText('Saved.')).toBeVisible();
 await page.getByRole('checkbox', { name: 'I checked the specifications' }).check();
 await page.getByRole('button', { name: 'Publish RFQ', exact: true }).click();
 expect((await (await page.request.get('/api/erp/procurement')).json()).rfqs[0].status).toBe('draft');
 await page.getByLabel('Intervention reason').fill('Purchase manager not set up yet');
 await page.getByRole('button', { name: 'Publish RFQ', exact: true }).click();
 await expect(page.getByText('1 supplier portal recipients')).toBeVisible();
 expect((await post('/portal/login', { email: 'gate@factory.test', password: supplierPassword })).status).toBe(200);
 const rfq = (await (await page.request.get('/api/erp/procurement')).json()).rfqs[0];
 const bid = await post('/portal/bids', { id: crypto.randomUUID(), rfqId: rfq.id, version: 0, quantityMilli: rfq.quantity_milli, priceMinor: 125000, currency: 'PKR', paymentTerms: 'Net 30 after delivery', deliveryAt: Date.now() + 7 * 86400000, validUntil: Date.now() + 3 * 86400000, note: '' });
 expect(bid.status).toBe(201);
 await page.getByRole('button', { name: 'Refresh', exact: true }).click();
 await page.getByRole('button', { name: 'Review and accept bid' }).click();
 await page.getByRole('checkbox', { name: 'I accept this bid revision' }).check();
 await page.getByLabel('Intervention reason').fill('Purchase manager not set up yet');
 await page.getByRole('button', { name: 'Accept and create purchase order' }).click();
 await expect(page.getByText('Sent to the admin for approval. The purchase order is created once approved.')).toBeVisible();
 await expect(page.getByText('Waiting for admin approval.', { exact: false })).toBeVisible();
 await expect(page.locator('.erp-status').filter({ hasText: /^open$/ })).toBeVisible();
});
