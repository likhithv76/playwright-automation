import { test as base, expect } from '@playwright/test';
import { ReportGenerator, QuestionResult } from '../utils/reportGenerator';
import { GeminiAnalyzer } from '../utils/geminiAnalyzer';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const BASE_URL = process.env.BASE_URL || 'https://lms.exskilence.com';
const TARGET_PATH = process.env.TARGET_PATH || '/testing/coding/cs';
const START_FROM_QUESTION = parseInt(process.env.START_FROM || '1');
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
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  const dashboardVisible = await page.locator('text=Dashboard').isVisible().catch(() => false);
  if (dashboardVisible) return;
  console.log('Manual login required...');
  const start = Date.now();
  while (Date.now() - start < 180000) {
    const currentUrl = page.url();
    if (currentUrl.includes('/Dashboard')) break;
    await page.waitForTimeout(2000);
  }
  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
  await context.storageState({ path: STORAGE_PATH });
}

async function navigateToCodingQuestions(page) {
  await page.goto(`${BASE_URL}${TARGET_PATH}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const allButtons = await page.locator('button').all();
  const count = await Promise.all(
    allButtons.map(async (b) => (await b.textContent())?.trim().match(/^Q\d+$/) ? 1 : 0)
  );
  console.log(`Found ${count.filter(Boolean).length} question buttons.`);
}

async function detectTotalQuestions(page) {
  const questionButtons = await page.locator('button:has-text("Q")').all();
  const questionNumbers: number[] = [];
  for (const button of questionButtons) {
    const text = await button.textContent();
    if (text && /^Q\d+$/.test(text.trim())) questionNumbers.push(parseInt(text.replace('Q', '')));
  }
  return questionNumbers.length ? Math.max(...questionNumbers) : 90;
}

async function navigateToQuestion(page, questionNumber) {
  const questionText = `Q${questionNumber}`;
  const selectors = [
    `button:text-is("${questionText}")`,
    `button:text-exact("${questionText}")`,
    `button[style*="width: 50px; height: 50px"]:text-is("${questionText}")`,
  ];
  for (const selector of selectors) {
    const button = page.locator(selector);
    if (await button.isVisible({ timeout: 2000 })) {
      await button.scrollIntoViewIfNeeded();
      await button.click();
      await page.waitForTimeout(500);
      return true;
    }
  }
  return false;
}

async function solveQuestion(page, questionNumber, reportGenerator) {
  const result = {
    questionNumber: `Q${questionNumber}`,
    questionText: '',
    code: '',
    status: 'FAILED',
    timestamp: new Date().toISOString(),
  } as QuestionResult;

  try {
    await page.waitForTimeout(500);
    const questionElement = page.locator(
      'xpath=/html/body/div/div/div[3]/div[2]/div/div/div/div/div/div/div/div[2]/div/div[1]/div'
    );
    result.questionText = (await questionElement.textContent()) || `Question ${questionNumber}`;

    const codeElement = page.locator(
      'xpath=/html/body/div/div/div[3]/div[2]/div/div/div/div/div/div/div/div[3]/div[1]/div[2]/div/div/div[2]/div[2]'
    );
    result.code = (await codeElement.inputValue().catch(() => 'Code not captured')) || 'Code not captured';

    const runButton = page.locator('button:has-text("RUN"), button:has-text("Run")');
    if (await runButton.isVisible({ timeout: 2000 })) await runButton.click({ force: true });
    await page.waitForTimeout(1000);

    const resultText = await page
      .locator('/html/body/div/div/div[3]/div[2]/div/div/div/div/div/div/div/div[3]/div[2]/div/div[1]/h5')
      .textContent()
      .catch(() => '');
    if (resultText?.toLowerCase().includes('congratulations')) result.status = 'PASSED';
    else if (resultText?.toLowerCase().includes('wrong')) result.status = 'FAILED';
    else result.status = 'SKIPPED';
  } catch (err) {
    result.status = 'FAILED';
    result.errorMessage = err.message;
  }

  reportGenerator.addResult(result);
  return result;
}

test('Solve all coding questions', async ({ page, context }) => {
  const reportGenerator = new ReportGenerator();
  const geminiAnalyzer = new GeminiAnalyzer();
  let reportGenerated = false;

  const safeReport = (label = 'Partial') => {
    if (reportGenerator.results.length === 0) return;
    const reportPath = reportGenerator.generateExcelReport();
    const summary = reportGenerator.getSummary();
    console.log(`\n=== ${label} REPORT ===`);
    console.log(summary);
    console.log(`Saved: ${reportPath}`);
    reportGenerated = true;
  };

  process.on('SIGINT', () => {
    console.log('\nSIGINT received — saving partial report...');
    safeReport('Interrupted');
    setTimeout(() => process.exit(0), 2000);
  });

  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  );

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  const isLoggedIn = await page.locator('text=Dashboard').isVisible({ timeout: 5000 }).catch(() => false);
  if (!isLoggedIn) await loginToApp(page, context);

  await navigateToCodingQuestions(page);
  const totalQuestions = await detectTotalQuestions(page);
  console.log(`Detected ${totalQuestions} questions`);

  await navigateToQuestion(page, START_FROM_QUESTION);

  for (let i = START_FROM_QUESTION; i <= totalQuestions; i++) {
    console.log(`\n=== Processing Q${i} ===`);
    await navigateToQuestion(page, i);
    const result = await solveQuestion(page, i, reportGenerator);

    const currentResult = reportGenerator.results[reportGenerator.results.length - 1];
    if (currentResult && currentResult.code !== 'Code not captured') {
      try {
        const analysis = (await Promise.race([
          currentResult.codeFiles
            ? geminiAnalyzer.analyzeQuestionAndCode(
                currentResult.questionText,
                currentResult.code,
                currentResult.codeFiles
              )
            : geminiAnalyzer.analyzeQuestionAndCode(currentResult.questionText, currentResult.code),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 30000)),
        ])) as any;

        currentResult.geminiStatus = analysis.status;
        currentResult.geminiRemarks = analysis.remarks;
        currentResult.geminiUpdatedRequirements = analysis.updated_requirements || [];
        console.log(`${currentResult.questionNumber}: ${analysis.status} - ${analysis.remarks}`);
      } catch (error) {
        currentResult.geminiStatus = 'ERROR';
        currentResult.geminiRemarks = 'Gemini analysis failed or timed out';
      }
    } else {
      currentResult.geminiStatus = 'SKIPPED';
      currentResult.geminiRemarks = 'Skipped - insufficient data';
    }

    if (i % 15 === 0 && i < totalQuestions) {
      console.log(`Cooldown after ${i} questions...`);
      await page.waitForTimeout(10000);
    }

    if (reportGenerator.results.length % 25 === 0) {
      safeReport(`Checkpoint-${i}`);
      reportGenerator.results = [];
    }
  }

  console.log('\n=== Generating Final Report ===');
  safeReport('Final');
});
