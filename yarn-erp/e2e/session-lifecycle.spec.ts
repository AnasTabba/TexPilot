import { test, expect, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });
test.beforeEach(async ({ page }) => { await page.request.post('/__test/reset'); });

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Anas', exact: true }).click();
  await page.getByLabel('4-digit PIN', { exact: true }).fill('2468');
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
}

test('a second tab and reload share the signed-in session', async ({ page, context }) => {
  await signIn(page);
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  await second.reload();
  await expect(second.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
});

test('backgrounding and closing a tab keep the session active', async ({ page, context }) => {
  await signIn(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(async () => (await page.request.get('/api/workspace')).status()).toBe(200);
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto('/');
  await expect(reopened.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
});

test('explicit sign-out revokes the shared server session', async ({ page, context }) => {
  await signIn(page);
  if (await page.locator('.live-bottom-nav').isVisible()) await page.getByRole('button', { name: /More pages/ }).click();
  await page.getByRole('button', { name: 'Sign out Anas' }).filter({ visible: true }).click();
  await expect(page.getByRole('heading', { name: 'Who’s signing in?', exact: true })).toBeVisible();
  await expect.poll(async () => (await page.request.get('/api/workspace')).status()).toBe(401);
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByRole('heading', { name: 'Who’s signing in?', exact: true })).toBeVisible();
});
