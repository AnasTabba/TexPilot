import { test, expect } from '@playwright/test';
import { signIn } from './helpers';
import { NAV, COMMON, CHAT, type Section } from '../src/roles';

test.beforeEach(async ({ page }) => { await page.request.post('/__test/reset'); });

// The sidebar shows the role's own sections; LiveApp adds Stock for any role whose nav lacks it.
const stockSection = NAV.quality_inspector.find(section => section.id === 'inventory')!;
const sidebarFor = (role: keyof typeof NAV): Section[] => {
  const own = NAV[role];
  return own.some(section => section.id === 'inventory') ? own : [...own, stockSection];
};
// Notifications live behind the bell in the top bar, so the sidebar lists only Help beside Chat from COMMON.
const sidebarCommon = [CHAT, ...COMMON.filter(section => section.id !== 'notifications')];

for (const [name, role] of [
  ['Anas', 'admin'],
  ['Pervaiz', 'purchase_manager'],
  ['Saima', 'supervisor'],
  ['Sana', 'sales_manager'],
  ['Qasim', 'quality_inspector'],
  ['Danish', 'dispatch'],
] as const) test(`${name} sees only the sections of their role, plus the common ones`, async ({ page }) => {
  await signIn(page, name);
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  const expected = [...sidebarFor(role), ...sidebarCommon];
  // Chat is shared by every role, so it sits in the nav next to Help.
  for (const section of expected) await expect(nav.getByRole('button', { name: new RegExp(`^${section.en}`) })).toBeVisible();
  await expect(nav.getByRole('button')).toHaveCount(expected.length);
  await expect(nav.getByRole('button', { name: /^My profile/ })).toHaveCount(0);
});

test('a hash for a section the role lacks falls back to the dashboard', async ({ page }) => {
  await signIn(page, 'Sana');
  await page.goto('/#/team');
  await expect(page.getByRole('heading', { level: 1, name: 'Home', exact: true })).toBeVisible();
});

test('a notification appears with its unread count and opens its item', async ({ page }) => {
  // The supplier intake API arrives with a later task; the test server raises the same event directly.
  const made = await page.request.post('/__test/notify', { data: { role: 'purchase_manager', event: 'supplier.pending', objectType: 'supplier', objectId: crypto.randomUUID(), label: 'Noor Spinning' } });
  expect(made.ok()).toBeTruthy();
  await signIn(page, 'Pervaiz');
  const bell = page.locator('.live-head-actions').getByRole('button', { name: /^Notifications/ });
  await expect(bell).toHaveAccessibleName(/1 unread/);
  await expect(bell.locator('.yf-nav-count')).toHaveText('1');
  // Home lists the unread notice with its Unread status.
  const notice = page.getByRole('button', { name: /New supplier pending/ });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('Unread');
  await bell.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Notifications', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /New supplier pending/ }).click();
  await expect(page).toHaveURL(/#\/notifications$/);
  await expect(bell.locator('.yf-nav-count')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /New supplier pending/ })).toContainText('Noor Spinning');
});

test('My profile shows the role and switches language', async ({ page }) => {
  await signIn(page, 'Pervaiz');
  await page.locator('.live-sidebar .yf-me').getByRole('button', { name: /Open my profile/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'My profile', exact: true })).toBeVisible();
  await expect(page.getByText('Purchase Manager').first()).toBeVisible();
  // Language is a radio tile on the profile page.
  await page.getByRole('radio', { name: 'اردو', exact: true }).check();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1, name: 'میری پروفائل', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('the InvenTree check is for admins only and reports in both languages', async ({ page }) => {
  await signIn(page, 'Anas');
  await page.goto('/#/profile');
  await page.getByRole('button', { name: 'Check InvenTree' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'InvenTree is not deployed or connected' })).toBeVisible();
  await page.getByRole('radio', { name: 'اردو', exact: true }).check();
  await expect(page.getByRole('status').filter({ hasText: 'InvenTree لگا یا جڑا' })).toBeVisible();
  await page.getByRole('radio', { name: 'English', exact: true }).check();
  page.once('dialog', dialog => void dialog.accept());
  await page.getByRole('button', { name: 'Sign out Anas' }).click();
  await signIn(page, 'Pervaiz');
  await page.goto('/#/profile');
  await expect(page.getByRole('heading', { level: 1, name: 'My profile', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check InvenTree' })).toHaveCount(0);
});
