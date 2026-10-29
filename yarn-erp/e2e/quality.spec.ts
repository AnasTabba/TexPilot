import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

test.beforeEach(async ({ page }) => { await page.request.post('/__test/reset'); });

test('quality inspector gets oldest-lot dashboard and inspection-only navigation', async ({ page }, testInfo) => {
  await signIn(page, 'Qasim');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('button', { name: /^Lots/ })).toBeVisible();
  await expect(nav.getByRole('button', { name: /^My submissions/ })).toBeVisible();
  await expect(nav.getByRole('button', { name: /^Stock/ })).toHaveCount(0);
  await expect(page.getByText(/oldest waiting lot|No lots are waiting/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('quality-dashboard-desktop.png'), fullPage: true });
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
