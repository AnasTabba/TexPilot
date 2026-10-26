import { test, expect, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });
test.beforeEach(async ({ page }) => { await page.request.post('/__test/reset'); });

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Anas', exact: true }).click();
  await page.getByLabel('4-digit PIN').fill('2468');
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
}

test('Urdu selection persists through sign-in, navigation and reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Language / زبان' }).selectOption('ur');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ur');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'کون سائن اِن کر رہا ہے؟' })).toBeVisible();
  await page.getByRole('button', { name: 'Anas', exact: true }).click();
  await page.getByLabel('چار ہندسوں کا پن').fill('2468');
  await expect(page.getByRole('heading', { name: 'ہوم', exact: true })).toBeVisible();
  await page.goto('/#/scanner');
  await expect(page.getByRole('button', { name: 'کپڑا', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'اسکین', exact: true })).toBeVisible();
  await page.goto('/#/settings');
  await page.getByRole('combobox', { name: 'Language / زبان' }).selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
});

for (const language of ['en', 'ur']) for (const [width, height] of [[375, 548], [390, 664], [1280, 633]]) {
  test(`${language}: keypad and scan inputs fit ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    if (language === 'ur') await page.getByRole('combobox', { name: 'Language / زبان' }).selectOption('ur');
    await page.getByRole('button', { name: 'Anas', exact: true }).click();
    const keypad = page.locator('.yf-keypad');
    await expect(keypad).toBeVisible();
    const zero = await keypad.getByRole('button', { name: '0', exact: true }).boundingBox();
    expect(zero!.y + zero!.height).toBeLessThanOrEqual(height);
    expect(zero!.width).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.scrollingElement!.scrollHeight - innerHeight)).toBeLessThanOrEqual(1);
    await page.getByLabel(language === 'ur' ? 'چار ہندسوں کا پن' : '4-digit PIN').fill('2468');
    await expect(page.getByRole('heading', { name: language === 'ur' ? 'ہوم' : 'Home', exact: true })).toBeVisible();
    await page.goto('/#/scanner');
    const open = page.locator('.scan-camera-controls button').first();
    await expect(open).toBeVisible();
    const nav = page.locator('.live-bottom-nav');
    const limit = await nav.isVisible() ? (await nav.boundingBox())!.y : height;
    const fabricCamera = await open.boundingBox();
    expect(fabricCamera!.y + fabricCamera!.height).toBeLessThanOrEqual(limit - 4);
    await page.getByRole('button', { name: language === 'ur' ? 'اسٹاک لیبل' : 'Stock label', exact: true }).click();
    const camera = await page.locator('.barcode-panel button.primary').boundingBox();
    expect(camera!.y + camera!.height).toBeLessThanOrEqual(limit - 4);
    await page.getByRole('button', { name: language === 'ur' ? 'یارن کاؤنٹ' : 'Yarn count', exact: true }).click();
    const photo = page.locator('.spec-form input[type=file]').first();
    const box = await photo.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(limit - 4);
  });
}
