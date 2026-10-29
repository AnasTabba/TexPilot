import { defineConfig, devices } from '@playwright/test';
const port = Number(process.env.YARNFLOW_TEST_PORT || 8794);
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1,
  forbidOnly: !!process.env.CI, retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'iphone-webkit', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: `YARNFLOW_LOCAL_DEV=1 YARNFLOW_TEST_MODE=1 YARNFLOW_SEED_PIN=2468 YARNFLOW_SQLITE_PATH=:memory: SUPPLIER_PORTAL_TOKEN=e2e-supplier-portal-token-000000000000 BUYER_PORTAL_TOKEN=e2e-buyer-portal-token-00000000000000000 PORT=${port} node scripts/dev-server.mjs`,
    url: baseURL, reuseExistingServer: !process.env.CI, timeout: 30000,
  },
});
