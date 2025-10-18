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
    // Wait for page to be stable
    await page.waitForTimeout(2000);

    // Try to get question text with better error handling
    try {
      result.questionText =
        (await page.locator('text=Question').first().textContent()) || `Question ${questionNumber}`;
    } catch (e) {
      result.questionText = `Question ${questionNumber}`;
      console.log(`Could not extract question text for Q${questionNumber}`);
    }

    // Try to get code with better error handling
    try {
      const codeEditor = page.locator('.ace_text-input');
      result.code = (await codeEditor.inputValue()) || 'Code not captured';
    } catch (e) {
      result.code = 'Code not captured';
      console.log(`Could not extract code for Q${questionNumber}`);
    }

    // Find and click RUN button with better error handling
    console.log(`Looking for RUN button for Q${questionNumber}...`);
    
    // Try multiple selectors for the RUN button
    const runButtonSelectors = [
      '//*[@id="root"]/div/div[3]/div[2]/div/div/div/div/div/div/div/div[3]/div[2]/div/div[2]/button',
      'button:has-text("RUN")',
      'button:has-text("Run")',
      '[data-testid="run-button"]',
      'button[aria-label*="run" i]'
    ];
    
    let runButton: any = null;
    let runVisible = false;
    
    for (const selector of runButtonSelectors) {
      try {
        const button = page.locator(selector);
        runVisible = await button.isVisible({ timeout: 3000 }).catch(() => false);
        if (runVisible) {
          runButton = button;
          console.log(`Found RUN button with selector: ${selector}`);
          break;
        }
      } catch (e) {
        // Continue to next selector
      }
    }
    
    if (runVisible && runButton) {
      await runButton.click();
      console.log(`Clicked RUN button for Q${questionNumber}`);
    } else {
      throw new Error(`Could not find RUN button for Q${questionNumber}`);
    }

    // Wait for page to process the submission
    await page.waitForTimeout(3000);

    // Check for success/failure messages with better error handling
    console.log(`Checking result for Q${questionNumber}...`);
    
    // Wait for any result message to appear
    try {
      await page.waitForSelector('text=Congratulations!, text=Wrong Answer', { 
        timeout: 15000 
      });
    } catch (e) {
      console.log(`No clear result message found for Q${questionNumber}, checking page state...`);
    }

    // Check for success indicators
    const success = await page
      .locator('text=Congratulations!, text=Correct')
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    // Check for failure indicators
    const failure = await page
      .locator('text=Wrong Answer, text=Incorrect')
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (success) {
      result.status = 'PASSED';
      console.log(`✅ Passed Q${questionNumber}`);
    } else if (failure) {
      result.status = 'FAILED';
      console.log(`❌ Failed Q${questionNumber}`);
    } else {
      result.status = 'SKIPPED';
      console.log(`⏭️ Skipped Q${questionNumber} (no clear result)`);
    }

    // Wait a bit more for page to stabilize before moving to next question
    await page.waitForTimeout(2000);

  } catch (err) {
    result.status = 'FAILED';
    result.errorMessage = err.message;
    console.error(`❌ Error in Q${questionNumber}: ${err.message}`);
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

  // Click Q1 to start
  await page.getByRole('button', { name: 'Q1', exact: true }).click();
  console.log('Starting with Q1...');

  for (let i = 1; i <= totalQuestions; i++) {
    await solveQuestion(page, i, reportGenerator);
    
    // Only try to navigate to next question if we're not on the last question
    if (i < totalQuestions) {
      console.log(`Looking for NEXT button to move to Q${i + 1}...`);
      
      // Try multiple selectors for the NEXT button
      const nextButtonSelectors = [
        '//*[@id="root"]/div/div[3]/div[2]/div/div/div/div/div/div/div/div[3]/div[2]/div/div[2]/button[2]',
        'button:has-text("NEXT")',
        'button:has-text("Next")',
        '[data-testid="next-button"]',
        'button[aria-label*="next" i]'
      ];
      
      let nextButton: any = null;
      let nextVisible = false;
      
      for (const selector of nextButtonSelectors) {
        try {
          const button = page.locator(selector);
          nextVisible = await button.isVisible({ timeout: 3000 }).catch(() => false);
          if (nextVisible) {
            nextButton = button;
            console.log(`Found NEXT button with selector: ${selector}`);
            break;
          }
        } catch (e) {
          // Continue to next selector
        }
      }
      
      if (nextVisible && nextButton) {
        try {
          await nextButton.click();
          console.log(`✅ Moving to Q${i + 1}...`);
          await page.waitForTimeout(2000); // Wait for page to load
        } catch (e) {
          console.log(`❌ Failed to click NEXT button: ${e.message}`);
          break;
        }
      } else {
        console.log('❌ No NEXT button found. Reached the last question or navigation failed.');
        break;
      }
    } else {
      console.log('✅ Completed all questions!');
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
