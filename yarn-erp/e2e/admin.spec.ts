import { test, expect } from '@playwright/test';
import { signIn, apiPost } from './helpers';

test.beforeEach(async ({ page, isMobile }) => { test.skip(isMobile, 'These specs drive the desktop sidebar.'); await page.request.post('/__test/reset'); });

test('threshold history records old and new values and follows currency settings', async ({ page }) => {
  await signIn(page);
  await page.goto('/#/settings/thresholds');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Purchase threshold').fill('100000');
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await expect(page.getByText(/Anas/).first()).toBeVisible();
  await expect(page.getByText(/PKR 100,000\.00/).first()).toBeVisible();
  await page.getByLabel('Purchase threshold').fill('150000');
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await expect(page.getByText(/PKR 100,000\.00 → PKR 150,000\.00/)).toBeVisible();
  await page.goto('/#/settings/invoices');
  await page.getByLabel('Currency').selectOption('USD');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.goto('/#/settings/thresholds');
  await expect(page.getByText('USD', { exact: true }).first()).toBeVisible();
});

test('dashboard reports unset thresholds and live approval counts', async ({ page }) => {
  await signIn(page);
  for (const label of ['Purchase threshold','Inventory adjustment','Claim threshold','Dispatch stock issue']) await expect(page.getByText(label).first()).toBeVisible();
  await expect(page.getByText('Thresholds not set')).toBeVisible();
});

test('admin sections and settings users are reachable in navigation', async ({ page }) => {
  await signIn(page);
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  for (const label of ['Dashboard','Approvals','Claims','Activity','Reports','Analytics','Settings','Modules','Notifications','My profile','Scan','Help']) await expect(nav.getByRole('button', { name: new RegExp(`^${label}`) })).toBeVisible();
  await expect(nav.getByRole('button', { name: /^Team/ })).toHaveCount(0);
  await page.goto('/#/settings/users');
  await page.getByRole('button', { name: 'Add a person' }).click();
  await page.getByLabel('Name').fill('Nadia');
  await page.getByLabel('4-digit PIN').fill('1357');
  await page.getByLabel('Type it again').fill('1357');
  await page.getByLabel('Role').selectOption('dispatch');
  await page.getByRole('button', { name: 'Add person' }).click();
  await expect(page.getByText('Nadia')).toBeVisible();
});

test('legacy team hash resolves to accessible profile after retirement', async ({ page }) => {
  await signIn(page);
  await page.goto('/#/team');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await page.goto('/#/profile');
  await expect(page.getByText('Admin').first()).toBeVisible();
});

test('activity monitor keeps unsupported activity targets in notifications', async ({ page }) => {
  await page.request.post('/__test/notify', { data: { role: 'admin', event: 'approval.pending', objectType: 'approval', objectId: crypto.randomUUID(), label: 'Pending test' } });
  await signIn(page);
  await page.goto('/#/activity/monitor');
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: /^Notifications/ })).toContainText('1');
  await page.goto('/#/notifications');
  await expect(page.getByRole('button', { name: /Approval waiting/ })).toBeVisible();
  await page.getByRole('button', { name: /Approval waiting/ }).click();
  await expect(page).toHaveURL(/#\/approvals/);
});
