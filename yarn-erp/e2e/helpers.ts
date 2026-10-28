import { expect, type Page } from '@playwright/test';

export const origin = `http://127.0.0.1:${process.env.YARNFLOW_TEST_PORT || 8794}`;

/** Sign in with a name and 4-digit PIN. The app now opens on the PIN screen, not a workspace form. */
export async function signIn(page: Page, name = 'Anas', pin = '2468') {
  await page.goto('/');
  await page.getByRole('button', { name, exact: true }).click();
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
