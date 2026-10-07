import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', timeout: 120_000, fullyParallel: false, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173', headless: true, viewport: { width: 1440, height: 1000 },
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm run build && npm run preview -- --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: false },
});
