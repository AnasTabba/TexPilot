import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

test.beforeEach(async ({ page }) => { await page.request.post('/__test/reset'); });

for (const [name, sections] of [
  ['Anas', ['Dashboard', 'Stock', 'History', 'Team']],
  ['Pervaiz', ['Dashboard', 'Suppliers', 'RFQs', 'Orders', 'Claims', 'Analytics']],
  ['Saima', ['Dashboard', 'Reviews', 'Inventory', 'Requests', 'Report', 'History']],
  ['Sana', ['Dashboard', 'Buyers', 'Buyer RFQs', 'Invoices', 'Dispatch requests', 'Analytics']],
  ['Qasim', ['Dashboard', 'Lots', 'My submissions']],
  ['Danish', ['Dashboard', 'Dispatches', 'New dispatch', 'History']],
] as const) test(`${name} sees only the sections of their role, plus the common ones`, async ({ page }) => {
  await signIn(page, name);
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  for (const label of [...sections, 'Notifications', 'My profile', 'Scan', 'Help']) await expect(nav.getByRole('button', { name: new RegExp(`^${label}`) })).toBeVisible();
  await expect(nav.getByRole('button')).toHaveCount(sections.length + 4);
});

test('a hash for a section the role lacks falls back to the dashboard', async ({ page }) => {
  await signIn(page, 'Sana');
  await page.goto('/#/team');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard', exact: true })).toBeVisible();
});

test('dispatch role opens the approval-gated sale dispatch screen', async ({ page }) => {
  await signIn(page, 'Danish');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: /^Dispatches/ }).click();
  await expect(page.getByText('No dispatches in this view.')).toBeVisible();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'New dispatch', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Request dispatch approval' })).toBeVisible();
  await expect(page.locator('.live-warning').filter({ hasText: 'Raw stock cannot be sale-dispatched' })).toBeVisible();
});

test('invoice and dispatch notifications open the owner screen and admin module deep links', async ({ page, browser, baseURL }) => {
  const invoiceId = crypto.randomUUID();
  const ownerNotice = await page.request.post('/__test/notify', { data: { role: 'sales_manager', event: 'payment.overdue', objectType: 'invoice', objectId: invoiceId, label: 'INV-TEST' } });
  expect(ownerNotice.ok()).toBeTruthy();
  await signIn(page, 'Sana'); await page.goto('/#/notifications');
  await page.getByRole('button', { name: /Payment overdue/ }).click();
  await expect(page).toHaveURL(new RegExp(`#\\/invoices\\/${invoiceId}$`));

  const dispatchId = crypto.randomUUID();
  const dispatchNotice = await page.request.post('/__test/notify', { data: { role: 'dispatch', event: 'dispatch.approval_requested', objectType: 'dispatch', objectId: dispatchId, label: 'SO-TEST' } });
  expect(dispatchNotice.ok()).toBeTruthy();
  const dispatchContext = await browser.newContext({ baseURL }); const dispatch = await dispatchContext.newPage();
  try {
    await signIn(dispatch, 'Danish'); await dispatch.goto('/#/notifications');
    await dispatch.getByRole('button', { name: /Dispatch needs approval/ }).click();
    await expect(dispatch).toHaveURL(new RegExp(`#\\/dispatches\\/${dispatchId}$`));
  } finally { await dispatchContext.close(); }

  const adminId = crypto.randomUUID();
  const adminNotice = await page.request.post('/__test/notify', { data: { role: 'admin', event: 'payment.overdue', objectType: 'invoice', objectId: adminId, label: 'INV-ADMIN' } });
  expect(adminNotice.ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Sign out Sana', exact: true }).click();
  await page.goto('/'); await page.getByRole('button', { name: 'Anas', exact: true }).click(); await page.getByLabel('4-digit PIN', { exact: true }).fill('2468');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible(); await page.goto('/#/notifications');
  await page.getByRole('button', { name: /Payment overdue/ }).click();
  await expect(page).toHaveURL(new RegExp(`#\\/modules\\/sales\\/invoices\\/${adminId}$`));
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page).toHaveURL(/#\/dashboard$/);
});

test('a notification appears with its unread count and opens its item', async ({ page }) => {
  // The supplier intake API arrives with a later task; the test server raises the same event directly.
  const made = await page.request.post('/__test/notify', { data: { role: 'purchase_manager', event: 'supplier.pending', objectType: 'supplier', objectId: crypto.randomUUID(), label: 'Noor Spinning' } });
  expect(made.ok()).toBeTruthy();
  await signIn(page, 'Pervaiz');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  const bell = nav.getByRole('button', { name: /^Notifications/ });
  await expect(bell.locator('.yf-nav-count')).toHaveText('1');
  await expect(page.getByRole('heading', { level: 2, name: 'Next: New supplier pending' })).toBeVisible();
  await bell.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Notifications', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /New supplier pending/ }).click();
  await expect(page).toHaveURL(/#\/suppliers\//);
  await expect(bell.locator('.yf-nav-count')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: 'Suppliers', exact: true })).toBeVisible();
});

test('My profile shows the role and switches language', async ({ page }) => {
  await signIn(page, 'Pervaiz');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: /^My profile/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'My profile', exact: true })).toBeVisible();
  await expect(page.getByText('Purchase Manager').first()).toBeVisible();
  await page.getByRole('button', { name: /Switch language to Urdu/ }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1, name: 'میری پروفائل', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('the InvenTree check is for admins only and reports in both languages', async ({ page }) => {
  await signIn(page, 'Anas');
  await page.goto('/#/profile');
  await page.getByRole('button', { name: 'Check InvenTree' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'InvenTree is not deployed or connected' })).toBeVisible();
  await page.getByRole('button', { name: /Switch language to Urdu/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'InvenTree لگا یا جڑا' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch language to English' }).click();
  await page.getByRole('button', { name: 'Sign out Anas' }).click();
  await signIn(page, 'Pervaiz');
  await page.goto('/#/profile');
  await expect(page.getByRole('heading', { level: 1, name: 'My profile', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check InvenTree' })).toHaveCount(0);
});

test('quality and stock-issue notifications open the exact item for the inspector, the supervisor and the admin module', async ({ browser, baseURL, page }) => {
  const lotId = crypto.randomUUID(), submittedId = crypto.randomUUID(), decidedId = crypto.randomUUID(), issueId = crypto.randomUUID();
  const raise = async (role: string, event: string, objectType: string, objectId: string, label: string) => expect((await page.request.post('/__test/notify', { data: { role, event, objectType, objectId, label } })).ok()).toBeTruthy();
  const open = async (name: string, title: RegExp, route: RegExp, heading: string, level = 1) => {
    const context = await browser.newContext({ baseURL }); const person = await context.newPage();
    try {
      await signIn(person, name); await person.goto('/#/notifications');
      await person.getByRole('button', { name: title }).click();
      await expect(person).toHaveURL(route);
      await expect(person.getByRole('heading', { level, name: heading, exact: true })).toBeVisible();
    } finally { await context.close(); }
  };
  await raise('quality_inspector', 'lot.ready', 'qc_lot', lotId, 'LOT-N');
  await raise('quality_inspector', 'inspection.decided', 'qc_inspection', decidedId, 'INS-D');
  await open('Qasim', /Lot ready for inspection/, new RegExp(`#\\/lots\\/${lotId}$`), 'Lots');
  await open('Qasim', /Inspection decided/, new RegExp(`#\\/submissions\\/${decidedId}$`), 'My submissions');
  await raise('supervisor', 'inspection.submitted', 'qc_inspection', submittedId, 'INS-S');
  await raise('supervisor', 'stock_issue.raised', 'stock_issue', issueId, 'SI-1');
  await open('Saima', /Inspection submitted/, new RegExp(`#\\/reviews\\/reports\\/${submittedId}$`), 'Reviews');
  await open('Saima', /Stock issue raised/, new RegExp(`#\\/requests\\/stock-issues\\/${issueId}$`), 'Requests');
  await raise('admin', 'lot.ready', 'qc_lot', lotId, 'LOT-N');
  await raise('admin', 'inspection.submitted', 'qc_inspection', submittedId, 'INS-S');
  await raise('admin', 'stock_issue.raised', 'stock_issue', issueId, 'SI-1');
  await open('Anas', /Lot ready for inspection/, new RegExp(`#\\/modules\\/quality\\/lots\\/${lotId}$`), 'Lots to inspect', 2);
  await open('Anas', /Inspection submitted/, new RegExp(`#\\/modules\\/supervisor\\/reviews\\/reports\\/${submittedId}$`), 'Inspection review', 2);
  await open('Anas', /Stock issue raised/, new RegExp(`#\\/modules\\/supervisor\\/requests\\/stock-issues\\/${issueId}$`), 'Requests', 2);
});
