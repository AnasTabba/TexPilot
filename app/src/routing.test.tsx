/**
 * Platform routing, tested against the real src/app directory. The default
 * jest-expo preset runs as iOS, so these are the native-app expectations; the
 * web surfaces (landing page, dashboard) are checked in a browser.
 */
import { renderRouter, screen } from 'expo-router/testing-library';

beforeEach(() => {
  // The scanner home pings the API; keep the test offline.
  globalThis.fetch = jest.fn(() => Promise.reject(new Error('offline'))) as typeof fetch;
});

/**
 * RNTL 14 renders asynchronously and expo-router's renderRouter predates that:
 * it returns the pending render with getPathname() attached, and the documented
 * `expect(screen).toHavePathname()` does not work. Await it and read the path.
 */
async function openAt(initialUrl: string) {
  const app = renderRouter('src/app', { initialUrl });
  await app;
  return app.getPathname();
}

describe('native routing', () => {
  test('the app opens on the scanner, not the web landing page', async () => {
    expect(await openAt('/')).toBe('/scan');
    expect(await screen.findByText('Fabric verification')).toBeOnTheScreen();
  });

  test('the web-only dashboard sends a phone user to the scanner', async () => {
    expect(await openAt('/dashboard')).toBe('/scan');
  });
});
