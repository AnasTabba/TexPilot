import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1,
  forbidOnly: !!process.env.CI, retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:8791', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'iphone-webkit', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'YARNFLOW_LOCAL_DEV=1 YARNFLOW_TEST_MODE=1 YARNFLOW_SEED_PIN=2468 YARNFLOW_SQLITE_PATH=:memory: PORT=8791 node scripts/dev-server.mjs',
    url: 'http://127.0.0.1:8791', reuseExistingServer: !process.env.CI, timeout: 30000,
  },
});
