import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

test.beforeEach(async ({ page }) => { await page.request.post('/__test/reset'); });

for (const [name, sections] of [
  ['Anas', ['Dashboard', 'Stock', 'History', 'Procurement', 'Team']],
  ['Pervaiz', ['Dashboard', 'Procurement']],
  ['Saima', ['Dashboard', 'Review', 'Stock', 'History', 'Dispatch']],
  ['Sana', ['Dashboard', 'Dispatch']],
  ['Qasim', ['Dashboard', 'Inspections', 'Stock', 'History']],
  ['Danish', ['Dashboard', 'Dispatch', 'Stock', 'History']],
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
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: /^Dispatch/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dispatch', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Dispatch workflow', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: 'Request a sale dispatch', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request approval', exact: true })).toBeVisible();
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
  await expect(page).toHaveURL(/#\/notifications$/);
  await expect(bell.locator('.yf-nav-count')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /New supplier pending/ })).toContainText('Noor Spinning');
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
