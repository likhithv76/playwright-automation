import { test as base, expect } from '@playwright/test';
import { ReportGenerator, QuestionResult } from '../utils/reportGenerator';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = process.env.BASE_URL || 'https://lms.exskilence.com';
const TARGET_PATH = '/testing/coding/ht';
const AUTH_DIR = path.join(__dirname, '..', 'playwright', '.auth');
const STORAGE_PATH = path.join(AUTH_DIR, 'user.json');

const test = base.extend({
  storageState: async ({}, use) => {
    if (fs.existsSync(STORAGE_PATH)) {
      console.log('Loading saved session from', STORAGE_PATH);
      await use(STORAGE_PATH);
    } else {
      console.log('No saved session found, will perform manual login');
      await use(undefined);
    }
  },
});

export { test, expect };

async function loginToApp(page, context) {
  console.log('Starting Google OAuth login flow...');
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  const dashboardVisible = await page
    .locator('text=Dashboard')
    .isVisible()
    .catch(() => false);
  if (dashboardVisible) {
    console.log('Already logged in.');
    return;
  }

  console.log('Please manually complete Google login...');
  const start = Date.now();
  const maxWait = 180000;

  while (Date.now() - start < maxWait) {
    const currentUrl = page.url();
    if (
      currentUrl.includes('/Dashboard') ||
      currentUrl.includes('/dashboard')
    ) {
      console.log('Dashboard detected, login successful.');
      break;
    }
    await page.waitForTimeout(2000);
  }

  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
  await context.storageState({ path: STORAGE_PATH });
  console.log('Session saved to:', STORAGE_PATH);
}

async function navigateToCodingQuestions(page) {
  console.log(`Navigating to coding questions: ${BASE_URL}${TARGET_PATH}`);
  await page.goto(`${BASE_URL}${TARGET_PATH}`, { waitUntil: 'networkidle' });

  const url = page.url();
  if (url.includes('/testing/coding/ht')) {
    console.log('Reached coding page directly.');
    return;
  }

  if (url.includes('/Dashboard') || url.includes('/dashboard')) {
    console.log('From Dashboard → navigating to coding page...');
    await page.goto(`${BASE_URL}${TARGET_PATH}`, { waitUntil: 'networkidle' });
  }

  await page.waitForSelector('button:has-text("Q1")', { timeout: 60000 });
  console.log('Coding questions page loaded.');
}

async function solveQuestion(page, questionNumber, reportGenerator) {
  console.log(`Solving Question ${questionNumber}...`);
  const result = {
    questionNumber: `Q${questionNumber}`,
    questionText: '',
    code: '',
    status: 'FAILED',
    timestamp: new Date().toISOString(),
  } as QuestionResult;

  try {
    await page.waitForTimeout(1000);

    result.questionText =
      (await page.locator('text=Question').first().textContent()) || '';

    const codeEditor = page.locator('.ace_text-input');
    result.code = (await codeEditor.inputValue()) || 'Code not captured';

    await page.locator('//*[@id="root"]/div/div[3]/div[2]/div/div/div/div/div/div/div/div[3]/div[2]/div/div[2]/button').click();

    const success = await page
      .locator('text=Congratulations!')
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    const failure = await page
      .locator('text=Wrong Answer')
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    if (success) {
      result.status = 'PASSED';
    } else if (failure) {
      result.status = 'FAILED';
    } else {
      result.status = 'SKIPPED';
    }
    console.log(success ? `Passed Q${questionNumber}` : `Failed Q${questionNumber}`);
  } catch (err) {
    result.status = 'FAILED';
    result.errorMessage = err.message;
    console.error(`Error in Q${questionNumber}: ${err.message}`);
  }

  reportGenerator.addResult(result);
  return result;
}

test('Solve all coding questions', async ({ page, context }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  const isLoggedIn = await page.locator('text=Dashboard').isVisible({ timeout: 5000 }).catch(() => false);
  
  if (!isLoggedIn) {
    console.log('Session expired or invalid. Performing manual login...');
    await loginToApp(page, context);
  } else {
    console.log('Session loaded successfully! Already logged in.');
  }

  await navigateToCodingQuestions(page);

  const reportGenerator = new ReportGenerator();
  const totalQuestions = 85;

  await page.getByRole('button', { name: 'Q1', exact: true }).click();
  console.log('Starting with Q1...');

  for (let i = 1; i <= totalQuestions; i++) {
    await solveQuestion(page, i, reportGenerator);
    
    const nextButton = page.locator('//*[@id="root"]/div/div[3]/div[2]/div/div/div/div/div/div/div/div[3]/div[2]/div/div[2]/button[2]');
    const nextVisible = await nextButton.isVisible().catch(() => false);
    
    if (nextVisible) {
      await nextButton.click();
      console.log(`Moving to Q${i + 1}...`);
      await page.waitForTimeout(500);
    } else {
      console.log('No NEXT button found. Reached the last question.');
      break;
    }
  }

  const reportPath = reportGenerator.generateExcelReport();
  const summary = reportGenerator.getSummary();

  console.log('\n=== SUMMARY ===');
  console.log(`Total: ${summary.total}`);
  console.log(`Passed: ${summary.passed}`);
  console.log(`Failed: ${summary.failed}`);
  console.log(`Success Rate: ${summary.successRate}%`);
  console.log(`📊 Report: ${reportPath}`);
});
