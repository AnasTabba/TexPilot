import { test, expect } from '@playwright/test';
import { origin, signIn } from './helpers';

test('purchase screens fit a phone in Urdu', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'This proof targets the iPhone project.');
  await page.request.post('/__test/reset');
  await signIn(page, 'Pervaiz');
  await page.goto(origin + '/#/profile');
  await page.getByRole('button', { name: /Switch language to Urdu/ }).click();
  for (const [path, heading] of [['suppliers', 'سپلائرز'], ['orders', 'آرڈر']] as const) {
    await page.goto(origin + '/#/' + path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  }
});
