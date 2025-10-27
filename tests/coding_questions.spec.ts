import { test as base, expect } from '@playwright/test';
import { ReportGenerator, QuestionResult } from '../utils/reportGenerator';
import { GeminiAnalyzer } from '../utils/geminiAnalyzer';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = process.env.BASE_URL || 'https://lms.exskilence.com';
const TARGET_PATH = process.env.TARGET_PATH || '/testing/coding/ht';
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

  await page.waitForSelector('button:has-text("Q1")', { timeout: 10000 });
  console.log('Coding questions page loaded.');
}

async function detectTotalQuestions(page) {
  console.log('Detecting total number of questions...');
  
  try {
    // Look for question buttons in the container
    const questionButtons = await page.locator('button:has-text("Q")').all();
    const questionNumbers: number[] = [];
    
    console.log(`Found ${questionButtons.length} buttons containing "Q"`);
    
    for (const button of questionButtons) {
      try {
        const text = await button.textContent();
        console.log(`Button text: "${text}"`);
        if (text && text.match(/^Q\d+$/)) {
          const number = parseInt(text.replace('Q', ''));
          if (!isNaN(number)) {
            questionNumbers.push(number);
            console.log(`Added Q${number} to list`);
          }
        }
      } catch (e) {
        continue;
      }
    }
    
    if (questionNumbers.length > 0) {
      const maxQuestion = Math.max(...questionNumbers);
      console.log(`Detected ${questionNumbers.length} question buttons, max question: Q${maxQuestion}`);
      return maxQuestion;
    }
    
    // Fallback: try to find buttons with specific styling
    const styledButtons = await page.locator('button[style*="width: 50px; height: 50px"]').all();
    console.log(`Found ${styledButtons.length} styled buttons, checking for question numbers...`);
    
    for (const button of styledButtons) {
      try {
        const text = await button.textContent();
        console.log(`Styled button text: "${text}"`);
        if (text && text.match(/^Q\d+$/)) {
          const number = parseInt(text.replace('Q', ''));
          if (!isNaN(number)) {
            questionNumbers.push(number);
            console.log(`Added Q${number} to list via styling`);
          }
        }
      } catch (e) {
        continue;
      }
    }
    
    if (questionNumbers.length > 0) {
      const maxQuestion = Math.max(...questionNumbers);
      console.log(`Detected ${questionNumbers.length} question buttons, max question: Q${maxQuestion}`);
      return maxQuestion;
    }
    
    // Additional fallback: try to find any buttons with Q pattern
    console.log('Trying additional fallback selectors...');
    const allButtons = await page.locator('button').all();
    console.log(`Found ${allButtons.length} total buttons on page`);
    
    for (let i = 0; i < Math.min(allButtons.length, 20); i++) {
      try {
        const text = await allButtons[i].textContent();
        if (text && text.match(/^Q\d+$/)) {
          const number = parseInt(text.replace('Q', ''));
          if (!isNaN(number)) {
            questionNumbers.push(number);
            console.log(`Found Q${number} via fallback`);
          }
        }
      } catch (e) {
        continue;
      }
    }
    
    if (questionNumbers.length > 0) {
      const maxQuestion = Math.max(...questionNumbers);
      console.log(`Detected ${questionNumbers.length} question buttons via fallback: [${questionNumbers.join(', ')}], max question: Q${maxQuestion}`);
      return maxQuestion;
    }
    
  } catch (e) {
    console.log(`Error detecting questions: ${e.message}`);
  }
  
  console.log('Could not detect total questions, using default of 90');
  return 90; // Default fallback
}

async function verifyNextQuestionExists(page, currentQuestionNumber) {
  console.log(`Verifying if Q${currentQuestionNumber + 1} exists...`);
  
  try {
    // Use exact text matching to avoid strict mode violations
    const nextQuestionText = `Q${currentQuestionNumber + 1}`;
    
    // Try different approaches for exact matching
    const selectors = [
      `button:text-is("${nextQuestionText}")`,
      `button:text-exact("${nextQuestionText}")`,
      `button:has-text("${nextQuestionText}"):not(:has-text("${nextQuestionText}0")):not(:has-text("${nextQuestionText}1")):not(:has-text("${nextQuestionText}2")):not(:has-text("${nextQuestionText}3")):not(:has-text("${nextQuestionText}4")):not(:has-text("${nextQuestionText}5")):not(:has-text("${nextQuestionText}6")):not(:has-text("${nextQuestionText}7")):not(:has-text("${nextQuestionText}8")):not(:has-text("${nextQuestionText}9"))`
    ];
    
    for (const selector of selectors) {
      try {
        console.log(`Trying selector: ${selector}`);
        const button = page.locator(selector);
        const isVisible = await button.isVisible({ timeout: 2000 });
        console.log(`Selector "${selector}" visibility: ${isVisible}`);
        if (isVisible) {
          console.log(`Q${currentQuestionNumber + 1} exists`);
          return true;
        }
      } catch (e) {
        console.log(`Error with selector "${selector}": ${e.message}`);
        continue;
      }
    }
    
    // Fallback: check all buttons and find exact match
    console.log('Using fallback method: checking all buttons for exact text match...');
    const allButtons = await page.locator('button').all();
    console.log(`Found ${allButtons.length} total buttons`);
    
    for (const button of allButtons) {
      try {
        const text = await button.textContent();
        if (text && text.trim() === nextQuestionText) {
          const isVisible = await button.isVisible({ timeout: 1000 });
          if (isVisible) {
            console.log(`Found exact match for Q${currentQuestionNumber + 1}`);
            return true;
          }
        }
      } catch (e) {
        continue;
      }
    }
    
    console.log(`Q${currentQuestionNumber + 1} does not exist`);
    return false;
  } catch (e) {
    console.log(`Error verifying next question: ${e.message}`);
    return false;
  }
}

async function navigateToQuestion(page, questionNumber) {
  console.log(`Navigating to Question ${questionNumber}...`);
  
  const questionText = `Q${questionNumber}`;
  
  // Try to find the question button using exact text matching
  const questionButtonSelectors = [
    `button:text-is("${questionText}")`,
    `button:text-exact("${questionText}")`,
    `button[style*="width: 50px; height: 50px"]:text-is("${questionText}")`
  ];
  
  for (const selector of questionButtonSelectors) {
    try {
      const button = page.locator(selector);
      if (await button.isVisible({ timeout: 3000 })) {
        await button.scrollIntoViewIfNeeded();
        await button.click();
        console.log(`Clicked Q${questionNumber} button`);
        await page.waitForTimeout(500); // Wait for question to load
        return true;
      }
    } catch (e) {
      console.log(`Selector "${selector}" failed: ${e.message}`);
      continue;
    }
  }
  
  // Fallback: check all buttons for exact text match
  console.log(`Using fallback method for Q${questionNumber}...`);
  const allButtons = await page.locator('button').all();
  
  for (const button of allButtons) {
    try {
      const text = await button.textContent();
      if (text && text.trim() === questionText) {
        const isVisible = await button.isVisible({ timeout: 1000 });
        if (isVisible) {
          await button.scrollIntoViewIfNeeded();
          await button.click();
          console.log(`Clicked Q${questionNumber} button via fallback`);
          await page.waitForTimeout(500);
          return true;
        }
      }
    } catch (e) {
      continue;
    }
  }
  
  console.log(`Could not find Q${questionNumber} button`);
  return false;
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
    await page.waitForTimeout(500);

    // Try to get question text using the provided XPath
    try {
      const questionElement = page.locator('xpath=/html/body/div/div/div[3]/div[2]/div/div/div/div/div/div/div/div[2]/div/div[1]/div');
      await questionElement.waitFor({ timeout: 2000 });
      result.questionText = (await questionElement.textContent()) || `Question ${questionNumber}`;
      console.log(`Extracted question text for Q${questionNumber}: ${result.questionText.substring(0, 100)}...`);
    } catch (e) {
      console.log(`Primary XPath failed for Q${questionNumber}, trying fallback selectors...`);
      
      // Try fallback selectors for question text
      const fallbackSelectors = [
        'text=Question',
        '[class*="question"]',
        'div:has-text("Question")',
        'h1, h2, h3, h4, h5, h6'
      ];
      
      let questionFound = false;
      for (const selector of fallbackSelectors) {
        try {
          const element = page.locator(selector).first();
          if (await element.isVisible({ timeout: 1000 })) {
            const text = await element.textContent();
            if (text && text.trim().length > 0) {
              result.questionText = text;
              console.log(`Extracted question text using fallback: ${selector}`);
              questionFound = true;
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!questionFound) {
        result.questionText = `Question ${questionNumber}`;
        console.log(`Could not extract question text for Q${questionNumber}: ${e.message}`);
      }
    }

    // Try to get code using the provided XPath
    try {
      const codeElement = page.locator('xpath=/html/body/div/div/div[3]/div[2]/div/div/div/div/div/div/div/div[3]/div[1]/div[2]/div/div/div[2]/div[2]');
      await codeElement.waitFor({ timeout: 2000 });
      result.code = (await codeElement.inputValue()) || 'Code not captured';
      console.log(`Extracted code for Q${questionNumber}: ${result.code.substring(0, 50)}...`);
    } catch (e) {
      console.log(`Primary XPath failed for code extraction Q${questionNumber}, trying fallback selectors...`);
      
      // Try fallback selectors for code
      const fallbackSelectors = [
        '.ace_text-input',
        'textarea',
        'input[type="text"]',
        '[contenteditable="true"]',
        'pre code',
        'code'
      ];
      
      let codeFound = false;
      for (const selector of fallbackSelectors) {
        try {
          const element = page.locator(selector).first();
          if (await element.isVisible({ timeout: 1000 })) {
            const code = await element.inputValue().catch(() => 
              element.textContent().catch(() => null)
            );
            if (code && code.trim().length > 0) {
              result.code = code;
              console.log(`Extracted code using fallback: ${selector}`);
              codeFound = true;
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!codeFound) {
        result.code = 'Code not captured';
        console.log(`Could not extract code for Q${questionNumber}: ${e.message}`);
      }
    }

    // Find and click RUN button using the provided XPath
    console.log(`Looking for RUN button for Q${questionNumber}...`);
    const runButtonXPath = '/html/body/div/div/div[3]/div[2]/div/div/div/div/div/div/div/div[3]/div[2]/div/div[2]';
    
    try {
      await page.waitForSelector(`xpath=${runButtonXPath}`, { timeout: 3000 });
      const runButton = page.locator(`xpath=${runButtonXPath}`);
      
      if (await runButton.isVisible()) {
        await runButton.scrollIntoViewIfNeeded();
        await runButton.click({ force: true });
        console.log(`Clicked RUN button for Q${questionNumber}`);
      } else {
        throw new Error('RUN button not visible');
      }
    } catch (e) {
      console.log('RUN button not found with XPath, trying fallback selectors...')
      const fallbackSelectors = [
        'button.processingDivButton',
        'button:has-text("RUN")',
        'button:has-text("Run")'
      ];
      
      let runButtonFound = false;
      for (const selector of fallbackSelectors) {
        try {
          const button = page.locator(selector);
          if (await button.isVisible({ timeout: 1000 })) {
            await button.click({ force: true });
            console.log(`Clicked RUN button using fallback selector: ${selector}`);
            runButtonFound = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!runButtonFound) {
        throw new Error('RUN button not found with any selector');
      }
    }

    // Wait for page to process the submission
    await page.waitForTimeout(1000);

    // Check for success/failure messages using the provided XPath
    console.log(`Checking result for Q${questionNumber}...`);
    const resultXPath = '/html/body/div/div/div[3]/div[2]/div/div/div/div/div/div/div/div[3]/div[2]/div/div[1]/h5';
    
    try {
      await page.waitForSelector(`xpath=${resultXPath}`, { timeout: 3000 });
      const resultElement = page.locator(`xpath=${resultXPath}`);
      const resultText = await resultElement.textContent();
      
      if (resultText && resultText.toLowerCase().includes('congratulations')) {
        result.status = 'PASSED';
        console.log(`Passed Q${questionNumber}`);
      } else if (resultText && resultText.toLowerCase().includes('Wrong Answer')) {
        result.status = 'FAILED';
        console.log(`Failed Q${questionNumber}`);
      } else {
        result.status = 'SKIPPED';
        console.log(`Skipped Q${questionNumber} (unclear result: ${resultText})`);
      }
    } catch (e) {
      console.log(`No result message found for Q${questionNumber}, checking with fallback selectors...`);
      
      // Fallback to text-based selectors
      const success = await page
        .locator('text=Congratulations!, text=Correct')
        .isVisible({ timeout: 2000 })
        .catch(() => false);

      const failure = await page
        .locator('text=Wrong Answer, text=Incorrect')
        .isVisible({ timeout: 2000 })
        .catch(() => false);

      if (success) {
        result.status = 'PASSED';
        console.log(`Passed Q${questionNumber} (fallback detection)`);
      } else if (failure) {
        result.status = 'FAILED';
        console.log(`Failed Q${questionNumber} (fallback detection)`);
      } else {
        result.status = 'SKIPPED';
        console.log(`Skipped Q${questionNumber} (no clear result)`);
      }
    }

    // Wait a bit more for page to stabilize before moving to next question
    await page.waitForTimeout(500);

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
  
  // Dynamically detect total number of questions
  const totalQuestions = await detectTotalQuestions(page);
  console.log(`Total questions detected: ${totalQuestions}`);

  // Navigate to Q1 to start
  const navigationSuccess = await navigateToQuestion(page, 1);
  if (!navigationSuccess) {
    console.log('Failed to navigate to Q1, trying fallback...');
    await page.getByRole('button', { name: 'Q1', exact: true }).click();
  }
  console.log('Starting with Q1...');

  for (let i = 1; i <= totalQuestions; i++) {
    console.log(`\n=== Processing Q${i} ===`);
    
    // Navigate to the question if we're not already on it
    if (i > 1) {
      const navSuccess = await navigateToQuestion(page, i);
      if (!navSuccess) {
        console.log(`Failed to navigate to Q${i}, checking if it exists...`);
        
        // Verify if the question actually exists
        const questionExists = await verifyNextQuestionExists(page, i - 1);
        if (!questionExists) {
          console.log(`Q${i} does not exist. Completed all available questions!`);
          break;
        }
        
        console.log(`Q${i} exists but navigation failed, skipping...`);
        const result = {
          questionNumber: `Q${i}`,
          questionText: `Question ${i}`,
          code: 'Navigation failed',
          status: 'SKIPPED',
          timestamp: new Date().toISOString(),
          errorMessage: 'Failed to navigate to question'
        } as QuestionResult;
        reportGenerator.addResult(result);
        continue;
      }
    }
    
    // Retry logic for solving questions (max 2 retries)
    let retryCount = 0;
    const maxRetries = 2;
    let skipToNext = false;
    
    while (retryCount <= maxRetries && !skipToNext) {
      const result = await solveQuestion(page, i, reportGenerator);
      
      // Check if question failed due to errors (not just wrong answer)
      if (result.errorMessage && retryCount < maxRetries) {
        retryCount++;
        console.log(`Q${i} failed with error: ${result.errorMessage.substring(0, 100)}`);
        console.log(`Retrying Q${i} (attempt ${retryCount}/${maxRetries})...`);
        
        // Remove the failed result from report
        reportGenerator.results.pop();
        
        await page.waitForTimeout(500); // Wait before retry
        // Try to re-navigate to the question
        await navigateToQuestion(page, i);
      } else {
        skipToNext = true;
        
        // If max retries reached and still failed, mark as SKIPPED
        if (result.errorMessage && retryCount === maxRetries) {
          console.log(`Q${i} failed after ${maxRetries} retries, marking as SKIPPED`);
          reportGenerator.results.pop(); // Remove the last failed result
          const skipResult = {
            questionNumber: `Q${i}`,
            questionText: result.questionText || `Question ${i}`,
            code: 'Retry exhausted',
            status: 'SKIPPED' as const,
            timestamp: new Date().toISOString(),
            errorMessage: `Failed after ${maxRetries} retries due to: ${result.errorMessage}`
          } as QuestionResult;
          reportGenerator.addResult(skipResult);
        }
      }
    }
    
    // Check if there's a next question before trying to navigate
    if (i < totalQuestions) {
      const nextQuestionExists = await verifyNextQuestionExists(page, i);
      
      if (!nextQuestionExists) {
        console.log(`No more questions after Q${i}. Completed all available questions!`);
        break;
      }
      
      console.log(`Looking for NEXT button to move to Q${i + 1}...`);
      
      // Try multiple selectors for the NEXT button
      const nextButtonSelectors = [
        '/html/body/div/div/div[3]/div[2]/div/div/div/div/div/div/div/div[3]/div[2]/div/div[2]/button[2]',
        'button:has-text("NEXT")',
        'button:has-text("Next")',
        '[data-testid="next-button"]',
        'button[aria-label*="next" i]'
      ];
      
      let nextButton: any = null;
      let nextVisible = false;
      
      for (const selector of nextButtonSelectors) {
        try {
      const button = selector.startsWith('/') 
        ? page.locator(`xpath=${selector}`)
        : page.locator(selector);
      nextVisible = await button.isVisible({ timeout: 1000 }).catch(() => false);
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
          console.log(`Moving to Q${i + 1}...`);
          await page.waitForTimeout(500); // Wait for page to load
        } catch (e) {
          console.log(`Failed to click NEXT button: ${e.message}`);
          // Don't break here, try direct navigation instead
          console.log(`Trying direct navigation to Q${i + 1}...`);
          const directNavSuccess = await navigateToQuestion(page, i + 1);
          if (!directNavSuccess) {
            console.log(`Direct navigation also failed, stopping...`);
            break;
          }
        }
      } else {
        console.log('No NEXT button found, trying direct navigation...');
        const directNavSuccess = await navigateToQuestion(page, i + 1);
        if (!directNavSuccess) {
          console.log(`Direct navigation failed, stopping...`);
          break;
        }
      }
    } else {
      console.log('Completed all questions!');
    }
  }

  console.log('\n=== Running Gemini Analysis ===');
  const geminiAnalyzer = new GeminiAnalyzer();
  
  // Perform Gemini analysis on all results
  let requestCount = 0;
  for (const result of reportGenerator.results) {
    if (result.questionText && result.code && result.code !== 'Code not captured') {
      try {
        console.log(`Analyzing ${result.questionNumber}...`);
        const analysisPromise = geminiAnalyzer.analyzeQuestionAndCode(result.questionText, result.code);
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 30000)
        );
        const analysis = await Promise.race([analysisPromise, timeoutPromise]) as any;
        result.geminiRemarks = analysis.remarks;
        console.log(`${result.questionNumber}: ${analysis.remarks.substring(0, 50)}...`);
        
        requestCount++;
        
        // Add 20 second delay after every 10 requests to avoid rate limits
        if (requestCount % 10 === 0) {
          console.log(`\nProcessed ${requestCount} requests. Waiting 20 seconds to avoid rate limits...`);
          await page.waitForTimeout(20000);
          console.log('Resuming analysis...\n');
        }
      } catch (error) {
        console.error(`Gemini analysis failed for ${result.questionNumber}`);
        result.geminiRemarks = 'Analysis timeout or failed';
        
        requestCount++;
        
        // Also count failed requests for rate limit management
        if (requestCount % 10 === 0) {
          console.log(`\nProcessed ${requestCount} requests. Waiting 20 seconds to avoid rate limits...`);
          await page.waitForTimeout(20000);
          console.log('Resuming analysis...\n');
        }
      }
    } else {
      result.geminiRemarks = 'Skipped - insufficient data';
    }
  }
  
  // Regenerate report with Gemini remarks
  console.log('\n=== Generating Final Report with Gemini Remarks ===');
  const reportPath = reportGenerator.generateExcelReport();
  const summary = reportGenerator.getSummary();

  console.log('\n=== SUMMARY ===');
  console.log(`Total: ${summary.total}`);
  console.log(`Passed: ${summary.passed}`);
  console.log(`Failed: ${summary.failed}`);
  console.log(`Success Rate: ${summary.successRate}%`);
  console.log(`Report: ${reportPath}`);
});
