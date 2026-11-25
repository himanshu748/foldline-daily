import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:5197';

export default defineConfig({
  testDir: './tools/harness',
  use: {
    baseURL,
    browserName: 'chromium',
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run harness -- --port 5197 --strictPort',
    env: { FOLDLINE_DATE: '2026-11-19' },
    url: `${baseURL}/src/client/game.html`,
  },
});
