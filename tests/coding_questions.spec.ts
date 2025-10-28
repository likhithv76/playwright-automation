import { test as base, expect } from '@playwright/test';
import { ReportGenerator, QuestionResult, CodeFile } from '../utils/reportGenerator';
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
  console.log(`Current URL after navigation: ${url}`);
  
  if (url.includes('/testing/coding/ht')) {
    console.log('Reached coding page directly.');
  } else if (url.includes('/Dashboard') || url.includes('/dashboard')) {
    console.log('From Dashboard → navigating to coding page...');
    await page.goto(`${BASE_URL}${TARGET_PATH}`, { waitUntil: 'networkidle' });
  }

  await page.waitForTimeout(2000);
  
  console.log('Waiting for question buttons to load...');
  
  const allButtons = await page.locator('button').all();
  console.log(`Found ${allButtons.length} total buttons on page`);
  
  let questionButtonsFound = 0;
  for (const button of allButtons) {
    try {
      const text = await button.textContent();
      if (text && /^Q\d+$/.test(text.trim())) {
        questionButtonsFound++;
        if (questionButtonsFound === 1) {
          console.log(`Found first question button: "${text.trim()}"`);
        }
      }
    } catch (e) {
      continue;
    }
  }
  
  if (questionButtonsFound > 0) {
    console.log(`Coding questions page loaded. Found ${questionButtonsFound} question buttons.`);
  } else {
    console.log('No question buttons found with exact Q pattern. Will attempt to continue anyway...');
    
    for (let i = 0; i < Math.min(allButtons.length, 10); i++) {
      try {
        const text = await allButtons[i].textContent();
        console.log(`Button ${i + 1}: "${text}"`);
      } catch (e) {
        continue;
      }
    }
  }
}

async function detectTotalQuestions(page) {
  console.log('Detecting total number of questions...');
  
  try {
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
  return 90;
}

async function verifyNextQuestionExists(page, currentQuestionNumber) {
  console.log(`Verifying if Q${currentQuestionNumber + 1} exists...`);
  
  try {
    const nextQuestionText = `Q${currentQuestionNumber + 1}`;
    
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
  
  const questionButtonSelectors = [
    `button:text-is("${questionText}")`,
    `button:text-exact("${questionText}")`,
    `button[style*="width: 50px; height: 50px"]:text-is("${questionText}")`
  ];
  
  for (const selector of questionButtonSelectors) {
    try {
      const button = page.locator(selector);
      if (await button.isVisible({ timeout: 1000 })) {
        await button.scrollIntoViewIfNeeded();
        await button.click();
        console.log(`Clicked Q${questionNumber} button`);
        await page.waitForTimeout(500);
        return true;
      }
    } catch (e) {
      console.log(`Selector "${selector}" failed: ${e.message}`);
      continue;
    }
  }
  
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
    await page.waitForTimeout(500);

    try {
      const questionElement = page.locator('xpath=/html/body/div/div/div[3]/div[2]/div/div/div/div/div/div/div/div[2]/div/div[1]/div');
      await questionElement.waitFor({ timeout: 2000 });
      result.questionText = (await questionElement.textContent()) || `Question ${questionNumber}`;
      console.log(`Extracted question text for Q${questionNumber}: ${result.questionText.substring(0, 100)}...`);
    } catch (e) {
      console.log(`Primary XPath failed for Q${questionNumber}, trying fallback selectors...`);
      
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

    try {
      const fileButtonsContainer = page.locator('xpath=/html/body/div/div/div[3]/div[2]/div/div/div/div/div/div/div/div[3]/div[1]/div[1]/div/div');
      
      let hasMultipleFiles = false;
      try {
        await fileButtonsContainer.waitFor({ timeout: 1000 });
        const buttons = await fileButtonsContainer.locator('button').all();
        hasMultipleFiles = buttons.length > 0;
        console.log(`Found ${buttons.length} file buttons for Q${questionNumber}`);
      } catch (e) {
      }

      if (hasMultipleFiles) {
        console.log(`Detected multiple code files for Q${questionNumber}`);
        const codeFiles: Array<{fileName: string, code: string}> = [];
        
        const buttons = await fileButtonsContainer.locator('button').all();
        
        for (let i = 0; i < buttons.length; i++) {
          try {
            const button = buttons[i];
            const fileName = await button.textContent();
            
            if (fileName && fileName.trim()) {
              console.log(`Clicking file button for: ${fileName.trim()}`);
              await button.click();
              await page.waitForTimeout(1000);
              
              let fileCode = '';
              
              try {
                const codeElement = page.locator('xpath=/html/body/div/div/div[3]/div[2]/div/div/div/div/div/div/div/div[3]/div[1]/div[2]/div/div/div[2]/div[2]');
                fileCode = (await codeElement.inputValue({ timeout: 2000 })) || '';
              } catch (e) {
                console.log(`XPath approach failed for ${fileName}, trying fallback...`);
              }
              
              if (!fileCode) {
                const fallbackSelectors = ['.ace_text-input', 'textarea', '[contenteditable="true"]'];
                for (const selector of fallbackSelectors) {
                  try {
                    const element = page.locator(selector).first();
                    if (await element.isVisible({ timeout: 1000 })) {
                      fileCode = await element.inputValue().catch(() => '') || '';
                      if (!fileCode) {
                        fileCode = await element.textContent().catch(() => '') || '';
                      }
                      if (fileCode) {
                        console.log(`Got code using fallback selector: ${selector}`);
                        break;
                      }
                    }
                  } catch (err) {
                    continue;
                  }
                }
              }
              
              if (!fileCode) {
                try {
                  const element = page.locator('[role="textbox"]').or(page.locator('.ace_text-input'));
                  if (await element.isVisible({ timeout: 1000 })) {
                    fileCode = await element.inputValue().catch(() => '') || '';
                  }
                } catch (err) {
                }
              }
              
              if (fileCode && fileCode.trim()) {
                codeFiles.push({ fileName: fileName.trim(), code: fileCode.trim() });
                console.log(`Extracted code from ${fileName.trim()}: ${fileCode.length} characters`);
              } else {
                console.log(`No code found for ${fileName.trim()}`);
              }
            }
          } catch (e) {
            console.log(`Failed to extract code from file button ${i + 1}: ${e.message}`);
          }
        }
        
        if (codeFiles.length > 0) {
          result.codeFiles = codeFiles;
          result.code = codeFiles.map(file => `=== ${file.fileName} ===\n${file.code}`).join('\n\n');
          console.log(`Successfully extracted ${codeFiles.length} file(s) for Q${questionNumber}`);
        } else {
          result.code = 'Code not captured from multiple files';
          console.log(`Failed to extract any code from multiple files for Q${questionNumber}`);
        }
      } else {
      const codeElement = page.locator('xpath=/html/body/div/div/div[3]/div[2]/div/div/div/div/div/div/div/div[3]/div[1]/div[2]/div/div/div[2]/div[2]');
      await codeElement.waitFor({ timeout: 2000 });
      result.code = (await codeElement.inputValue()) || 'Code not captured';
      console.log(`Extracted code for Q${questionNumber}: ${result.code.substring(0, 50)}...`);
      }
    } catch (e) {
      console.log(`Primary XPath failed for code extraction Q${questionNumber}, trying fallback selectors...`);
      
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

    console.log(`Looking for RUN button for Q${questionNumber}...`);
    const runButtonXPath = '/html/body/div/div/div[3]/div[2]/div/div/div/div/div/div/div/div[3]/div[2]/div/div[2]';
    
    try {
      await page.waitForSelector(`xpath=${runButtonXPath}`, { timeout: 1000 });
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

    await page.waitForTimeout(1000);

    console.log(`Checking result for Q${questionNumber}...`);
    const resultXPath = '/html/body/div/div/div[3]/div[2]/div/div/div/div/div/div/div/div[3]/div[2]/div/div[1]/h5';
    
    try {
      await page.waitForSelector(`xpath=${resultXPath}`, { timeout: 1000 });
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
  const reportGenerator = new ReportGenerator();
  const geminiAnalyzer = new GeminiAnalyzer();
  
  let reportGenerated = false;
  
  const generatePartialReport = () => {
    if (!reportGenerated && reportGenerator.results.length > 0) {
      console.log('\n\n=== Test Interrupted - Generating Partial Report ===');
      try {
        const reportPath = reportGenerator.generateExcelReport();
        const summary = reportGenerator.getSummary();

        console.log('\n=== PARTIAL SUMMARY ===');
        console.log(`Questions Processed: ${summary.total}`);
        console.log(`Passed: ${summary.passed}`);
        console.log(`Failed: ${summary.failed}`);
        console.log(`Skipped: ${summary.skipped}`);
        console.log(`Success Rate: ${summary.successRate}%`);
        console.log(`\nReport saved to: ${reportPath}`);
        reportGenerated = true;
      } catch (err) {
        console.error('Failed to generate partial report:', err.message);
      }
    }
  };
  
  const onSIGINT = () => {
    console.log('\n\nSIGINT received - generating partial report...');
    generatePartialReport();
    process.exit(0);
  };
  
  const onSIGTERM = () => {
    console.log('\n\nSIGTERM received - generating partial report...');
    generatePartialReport();
    process.exit(0);
  };
  
  process.on('SIGINT', onSIGINT);
  process.on('SIGTERM', onSIGTERM);
  
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

  try { 
  const totalQuestions = await detectTotalQuestions(page);
  console.log(`Total questions detected: ${totalQuestions}`);

    console.log(`\n=== Resuming from Q${START_FROM_QUESTION} ===`);
    const navigationSuccess = await navigateToQuestion(page, START_FROM_QUESTION);
  if (!navigationSuccess) {
      console.log(`Failed to navigate to Q${START_FROM_QUESTION}, trying fallback...`);
      await page.getByRole('button', { name: `Q${START_FROM_QUESTION}`, exact: true }).click();
  }
    console.log(`Starting with Q${START_FROM_QUESTION}...`);

    for (let i = START_FROM_QUESTION; i <= totalQuestions; i++) {
    console.log(`\n=== Processing Q${i} ===`);
    
      if (i > START_FROM_QUESTION) {
      const navSuccess = await navigateToQuestion(page, i);
      if (!navSuccess) {
        console.log(`Failed to navigate to Q${i}, checking if it exists...`);
        
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
          
          result.geminiStatus = 'SKIPPED';
          result.geminiRemarks = 'Skipped - navigation failed';
        continue;
      }
    }
    
    // Retry logic for solving questions (max 2 retries)
    let retryCount = 0;
    const maxRetries = 2;
    let skipToNext = false;
    
    while (retryCount <= maxRetries && !skipToNext) {
      const result = await solveQuestion(page, i, reportGenerator);
      
      if (result.errorMessage && retryCount < maxRetries) {
        retryCount++;
        console.log(`Q${i} failed with error: ${result.errorMessage.substring(0, 100)}`);
        console.log(`Retrying Q${i} (attempt ${retryCount}/${maxRetries})...`);
        
        reportGenerator.results.pop();
        
        await page.waitForTimeout(500);
        await navigateToQuestion(page, i);
      } else {
        skipToNext = true;
        
        if (result.errorMessage && retryCount === maxRetries) {
          console.log(`Q${i} failed after ${maxRetries} retries, marking as SKIPPED`);
          reportGenerator.results.pop();
          const skipResult = {
            questionNumber: `Q${i}`,
            questionText: result.questionText || `Question ${i}`,
            code: 'Retry exhausted',
            status: 'SKIPPED' as const,
            timestamp: new Date().toISOString(),
            errorMessage: `Failed after ${maxRetries} retries due to: ${result.errorMessage}`
          } as QuestionResult;
          reportGenerator.addResult(skipResult);
            skipResult.geminiStatus = 'SKIPPED';
            skipResult.geminiRemarks = 'Skipped - retry exhausted';
          }
        }
      }
      
      // Perform Gemini analysis on the current question's result
      console.log(`\n=== Running Gemini Analysis for Q${i} ===`);
      const currentResult = reportGenerator.results[reportGenerator.results.length - 1];
      
      // Skip analysis if already processed or if insufficient data
      if (currentResult) {
        if (currentResult.geminiRemarks) {
          console.log(`Skipping Gemini analysis for Q${i} - already processed`);
        } else if (currentResult.questionText && currentResult.code && 
                   currentResult.code !== 'Code not captured' && 
                   currentResult.code !== 'Navigation failed' && 
                   currentResult.code !== 'Retry exhausted') {
          try {
            console.log(`Analyzing ${currentResult.questionNumber}...`);
            
            const analysisPromise = currentResult.codeFiles 
              ? geminiAnalyzer.analyzeQuestionAndCode(
                  currentResult.questionText, 
                  currentResult.code, 
                  currentResult.codeFiles
                )
              : geminiAnalyzer.analyzeQuestionAndCode(
                  currentResult.questionText, 
                  currentResult.code
                );
            
            const timeoutPromise = new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Timeout')), 30000)
            );
            const analysis = await Promise.race([analysisPromise, timeoutPromise]) as any;
            currentResult.geminiStatus = analysis.status;
            currentResult.geminiRemarks = analysis.remarks;
            if (analysis.status && analysis.status !== 'MATCH' && Array.isArray(analysis.updatedRequirements)) {
              currentResult.geminiUpdatedRequirements = analysis.updatedRequirements;
            }
            console.log(`${currentResult.questionNumber}: ${analysis.status} - ${analysis.remarks}`);
            
            if (i % 15 === 0 && i < totalQuestions) {
              console.log(`\nProcessed ${i} questions. Adding 10s delay to prevent rate limiting...`);
              await page.waitForTimeout(10000);
              console.log('Resuming...\n');
            }
          } catch (error) {
            console.error(`Gemini analysis failed for ${currentResult.questionNumber}`);
            currentResult.geminiStatus = 'ERROR';
            currentResult.geminiRemarks = 'Analysis timeout or failed';
            
            if (i % 10 === 0) {
              console.log('Adding 5s delay after error to help with rate limits...');
              await page.waitForTimeout(5000);
            }
          }
        } else {
          console.log(`Skipping Gemini analysis for Q${i} - insufficient data`);
          currentResult.geminiStatus = 'SKIPPED';
          currentResult.geminiRemarks = 'Skipped - insufficient data';
        }
      }
    
    if (i < totalQuestions) {
      const nextQuestionExists = await verifyNextQuestionExists(page, i);
      
      if (!nextQuestionExists) {
        console.log(`No more questions after Q${i}. Completed all available questions!`);
        break;
      }
      
      console.log(`Looking for NEXT button to move to Q${i + 1}...`);
      
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
        }
      }
      
      if (nextVisible && nextButton) {
        try {
          await nextButton.click();
          console.log(`Moving to Q${i + 1}...`);
          await page.waitForTimeout(500);
        } catch (e) {
          console.log(`Failed to click NEXT button: ${e.message}`);
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

    console.log('\n=== Generating Final Report with Gemini Remarks ===');
    const reportPath = reportGenerator.generateExcelReport();
    const summary = reportGenerator.getSummary();
    reportGenerated = true;

    console.log('\n=== SUMMARY ===');
    console.log(`Total: ${summary.total}`);
    console.log(`Passed: ${summary.passed}`);
    console.log(`Failed: ${summary.failed}`);
    console.log(`Success Rate: ${summary.successRate}%`);
    console.log(`Report: ${reportPath}`);
      } catch (error) {
    console.error('\n=== Test interrupted or failed ===');
    console.error(`Error: ${error.message}`);
    
    // Generate partial report if we have any results
    if (reportGenerator.results.length > 0) {
      console.log('\n=== Generating Partial Report with Available Data ===');
      const reportPath = reportGenerator.generateExcelReport();
      const summary = reportGenerator.getSummary();
      reportGenerated = true;

      console.log('\n=== PARTIAL SUMMARY ===');
      console.log(`Total Processed: ${summary.total}`);
      console.log(`Passed: ${summary.passed}`);
      console.log(`Failed: ${summary.failed}`);
      console.log(`Success Rate: ${summary.successRate}%`);
      console.log(`Report saved to: ${reportPath}`);
    }
    
    throw error;
  } finally {
    // Cleanup signal handlers
    process.off('SIGINT', onSIGINT);
    process.off('SIGTERM', onSIGTERM);
    
    // Generate report if not already generated and we have results
    if (!reportGenerated && reportGenerator.results.length > 0) {
      console.log('\n=== Generating Report on Exit ===');
      try {
  const reportPath = reportGenerator.generateExcelReport();
  const summary = reportGenerator.getSummary();

        console.log('\n=== FINAL SUMMARY ===');
  console.log(`Total: ${summary.total}`);
  console.log(`Passed: ${summary.passed}`);
  console.log(`Failed: ${summary.failed}`);
  console.log(`Success Rate: ${summary.successRate}%`);
  console.log(`Report: ${reportPath}`);
      } catch (err) {
        console.error('Failed to generate report:', err.message);
      }
    }
  }
});
