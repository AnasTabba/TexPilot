import { test, expect, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });
test.beforeEach(async ({ page }) => { await page.request.post('/__test/reset'); });

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Anas', exact: true }).click();
  await page.getByLabel('4-digit PIN', { exact: true }).fill('2468');
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
}

async function visibility(page: Page, hidden: boolean) {
  await page.evaluate(hidden => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: hidden ? 'hidden' : 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    if (!hidden) window.dispatchEvent(new Event('focus'));
  }, hidden);
}

test('a fresh launch requires a PIN even when the browser restores a valid session cookie', async ({ page }) => {
  // A browser can restore session cookies after a crash/force-close without delivering pagehide.
  // Create that server state directly, with no page running an unload handler.
  const login = await page.request.post('/api/auth/login', {
    data: { name: 'Anas', pin: '2468' }, headers: { Origin: 'http://127.0.0.1:8791' },
  });
  expect(login.ok()).toBeTruthy();
  expect((await page.request.get('/api/workspace')).status()).toBe(200);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Who’s signing in?', exact: true })).toBeVisible();
  expect((await page.request.get('/api/workspace')).status()).toBe(401);
  await signIn(page);
});

test('backgrounding ends the server session and returning requires a PIN', async ({ page }) => {
  await signIn(page);
  await visibility(page, true);
  await expect(page.getByRole('heading', { name: 'Who’s signing in?', exact: true })).toBeVisible();
  await expect.poll(async () => (await page.request.get('/api/workspace')).status()).toBe(401);
  await visibility(page, false);
  await expect(page.getByRole('heading', { name: 'Who’s signing in?', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Who’s signing in?', exact: true })).toBeVisible();
  await signIn(page);
});

test('closing a signed-in tab ends its session before reopening', async ({ page, context }) => {
  await signIn(page);
  await page.close();
  const reopened = await context.newPage();
  await expect.poll(async () => (await reopened.request.get('/api/workspace')).status()).toBe(401);
  await reopened.goto('/');
  await expect(reopened.getByRole('heading', { name: 'Who’s signing in?', exact: true })).toBeVisible();
});

test('a failed logout request cannot restore stock through focus or reload', async ({ page }) => {
  await signIn(page);
  await page.route('**/api/auth/logout', route => route.abort('internetdisconnected'));
  await visibility(page, true);
  await expect(page.getByRole('heading', { name: 'Who’s signing in?', exact: true })).toBeVisible();
  // The server still holds the cookie: the local lock must stop silent restoration.
  expect((await page.request.get('/api/workspace')).status()).toBe(200);
  await visibility(page, false);
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: 'Who’s signing in?', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Who’s signing in?', exact: true })).toBeVisible();
  await page.unroute('**/api/auth/logout');
  await signIn(page);
});

test('a page restored from browser history stays signed out', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect(page.getByRole('heading', { name: 'Who’s signing in?', exact: true })).toBeVisible();
  await expect.poll(async () => (await page.request.get('/api/workspace')).status()).toBe(401);
});
