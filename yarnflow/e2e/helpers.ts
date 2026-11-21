import { expect, type Page } from '@playwright/test';

export const origin = `http://127.0.0.1:${process.env.YARNFLOW_TEST_PORT || 8794}`;

/** Sign in with a name and 4-digit PIN. The app now opens on the PIN screen, not a workspace form. */
export async function signIn(page: Page, name = 'Anas', pin = '2468') {
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(`^${name}\\b`) }).click();
  await page.getByLabel('4-digit PIN', { exact: true }).fill(pin);
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
}

/** One signed-in API call; the server rejects writes without a same-origin Origin header. */
export async function apiPost<T = Record<string, unknown>>(page: Page, path: string, data: object): Promise<T> {
  const response = await page.request.post('/api' + path, { data, headers: { Origin: origin } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

export async function workspace(page: Page) {
  const response = await page.request.get('/api/workspace');
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

/** The test database starts with four real-shaped yarns; tests identify them by batch number. */
export async function seededLot(page: Page, batch: string) {
  const state = await workspace(page);
  const lot = state.lots.find((candidate: { batch: string }) => candidate.batch === batch);
  expect(lot, `seeded batch ${batch}`).toBeTruthy();
  return { lot, state };
}

/** True on the phone layout, where the sidebar is hidden and a bottom bar plus a "More" sheet take over. */
export const onPhone = (page: Page) => page.locator('nav.live-bottom-nav').isVisible();

/** Open my profile from whichever control the layout shows (sidebar on desktop, top bar on phone). */
export async function openProfile(page: Page) {
  await page.getByRole('button', { name: /Open my profile/ }).filter({ visible: true }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'My profile', exact: true })).toBeVisible();
}

/** Sign out from the sidebar (desktop) or the More sheet (phone); the caller accepts the confirm dialog. */
export async function signOutAs(page: Page, name = 'Anas') {
  if (await onPhone(page)) {
    await page.getByRole('navigation', { name: 'Phone navigation' }).getByRole('button', { name: /^More/ }).click();
    await page.getByRole('navigation', { name: 'More sections' }).getByRole('button', { name: /^Sign out/ }).click();
  } else await page.getByRole('button', { name: `Sign out ${name}` }).click();
}

/** Run the scan again on the same photo. After a result the phone layout hides the capture panel behind "New scan". */
export async function analyzeAgain(page: Page) {
  const analyze = page.getByRole('button', { name: 'Analyze material', exact: true });
  if (!(await analyze.isVisible())) await page.getByRole('button', { name: 'New scan' }).click();
  await analyze.click();
}
