import { defineConfig, devices } from '@playwright/test';
import path from 'path';
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
export default defineConfig({
  testDir: './',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 15 * 60 * 1000, 
  headless: false,
  baseURL: process.env.BASE_URL,
  trace: 'on-first-retry',
  projects: [
    {
      name: 'setup',
      testMatch: 'global.setup.ts',
      teardown: 'global-teardown',
      use: {
        headless: false,
        launchOptions: {
          slowMo: 1000,
          args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-features=VizDisplayCompositor',
            '--disable-web-security',
            '--disable-features=TranslateUI',
            '--disable-ipc-flooding-protection',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-dev-shm-usage',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-field-trial-config',
            '--disable-back-forward-cache',
            '--disable-features=Translate',
            '--disable-features=BlinkGenPropertyTrees',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          ]
        },
      },
    },
    {
      name: 'global-teardown',
      testMatch: 'global-teardown.ts',
    },
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        headless: false,
        launchOptions: {
          slowMo: 1000,
          args: [
            '--start-maximized',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=VizDisplayCompositor',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-dev-shm-usage',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-field-trial-config',
            '--disable-back-forward-cache',
            '--disable-features=Translate',
            '--disable-features=BlinkGenPropertyTrees',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            '--disable-web-security',
            '--allow-running-insecure-content',
            '--disable-extensions',
            '--disable-plugins',
            '--disable-default-apps',
            '--disable-sync',
            '--disable-translate',
            '--hide-scrollbars',
            '--mute-audio',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1920,1080'
          ]
        },
      },
    }
});
