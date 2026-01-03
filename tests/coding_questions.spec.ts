import { test as base, expect } from '@playwright/test';
import { ReportGenerator, QuestionResult, CodeFile } from '../utils/reportGenerator';
import { GeminiAnalyzer } from '../utils/geminiAnalyzer';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// Load selectors config
const CONFIG_PATH = path.join(__dirname, '..', 'configs', 'version2.json');
const selectorsConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')).selectors_types;

const BASE_URL = process.env.BASE_URL || '';
const TARGET_PATH = process.env.TARGET_PATH || '';
const START_FROM_QUESTION = parseInt(process.env.START_FROM || '1');
const END_TO_QUESTION = process.env.END_TO ? parseInt(process.env.END_TO) : undefined;
const RUNNERS = parseInt(process.env.RUNNERS || '1');
const RUNNER_ID = parseInt(process.env.RUNNER_ID || '1');
const AUTH_DIR = path.join(__dirname, '..', 'playwright', '.auth');
const STORAGE_PATH = path.join(AUTH_DIR, 'user.json');

const test = base.extend({
  storageState: async ({}, use) => {
    // For runners 2+, wait for session file if it doesn't exist yet
    if (RUNNERS > 1 && RUNNER_ID > 1 && !fs.existsSync(STORAGE_PATH)) {
      console.log(`[Runner ${RUNNER_ID}] No session file yet, waiting for Runner 1...`);
      const start = Date.now();
      const maxWait = 300000; // 5 minutes
      while (Date.now() - start < maxWait && !fs.existsSync(STORAGE_PATH)) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      if (fs.existsSync(STORAGE_PATH)) {
        console.log(`[Runner ${RUNNER_ID}] Session file found after waiting!`);
      }
    }
    
    if (fs.existsSync(STORAGE_PATH)) {
      console.log(`[Runner ${RUNNER_ID}] Loading saved session from ${STORAGE_PATH}`);
      await use(STORAGE_PATH);
    } else {
      console.log(`[Runner ${RUNNER_ID}] No saved session found, will perform manual login`);
      await use(undefined);
    }
  },
});

export { test, expect };

async function waitForSessionFile(maxWait = 300000, checkInterval = 2000) {
  const start = Date.now();
  console.log(`[Runner ${RUNNER_ID}] Waiting for session file to be created by another runner...`);
  
  while (Date.now() - start < maxWait) {
    if (fs.existsSync(STORAGE_PATH)) {
      console.log(`[Runner ${RUNNER_ID}] Session file found!`);
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, checkInterval));
  }
  
  console.log(`[Runner ${RUNNER_ID}] Timeout waiting for session file`);
  return false;
}

async function loginToApp(page, context) {
  // If multiple runners, only runner 1 should do manual login
  // Other runners wait for runner 1 to create the session file
  if (RUNNERS > 1 && RUNNER_ID > 1) {
    console.log(`[Runner ${RUNNER_ID}] Waiting for Runner 1 to complete login...`);
    const sessionReady = await waitForSessionFile();
    if (sessionReady) {
      console.log(`[Runner ${RUNNER_ID}] Session ready, proceeding...`);
      // Wait a bit more for session to be fully written
      await new Promise(resolve => setTimeout(resolve, 2000));
      return;
    } else {
      console.log(`[Runner ${RUNNER_ID}] Session not ready, attempting own login...`);
    }
  }

  console.log(`[Runner ${RUNNER_ID}] Starting Google OAuth login flow...`);
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  const dashboardVisible = await page
    .locator('text=Dashboard')
    .isVisible({ timeout: 5000 })
    .catch(() => false);
  if (dashboardVisible) {
    console.log(`[Runner ${RUNNER_ID}] Already logged in.`);
    if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
    await context.storageState({ path: STORAGE_PATH });
    console.log(`[Runner ${RUNNER_ID}] Session saved to: ${STORAGE_PATH}`);
    return;
  }

  // Only show manual login prompt for runner 1 (or single runner)
  if (RUNNERS > 1 && RUNNER_ID === 1) {
    console.log(`[Runner ${RUNNER_ID}] Please manually complete Google login (other runners are waiting)...`);
  } else {
    console.log(`[Runner ${RUNNER_ID}] Please manually complete Google login...`);
  }

  const start = Date.now();
  const maxWait = 180000;

  while (Date.now() - start < maxWait) {
    const currentUrl = page.url();
    if (
      currentUrl.includes('/Dashboard') ||
      currentUrl.includes('/dashboard')
    ) {
      console.log(`[Runner ${RUNNER_ID}] Dashboard detected, login successful.`);
      break;
    }
    await page.waitForTimeout(2000);
  }

  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
  await context.storageState({ path: STORAGE_PATH });
  console.log(`[Runner ${RUNNER_ID}] Session saved to: ${STORAGE_PATH}`);
  
  // If multiple runners, notify others that session is ready
  if (RUNNERS > 1 && RUNNER_ID === 1) {
    console.log(`[Runner ${RUNNER_ID}] Session saved! Other runners can now proceed.`);
  }
}

async function navigateToCodingQuestions(page) {
  console.log(`[Runner ${RUNNER_ID}] Navigating to coding questions: ${BASE_URL}${TARGET_PATH}`);
  
  // Clear any cached state and navigate
  await page.goto(`${BASE_URL}${TARGET_PATH}`, { 
    waitUntil: 'networkidle',
    timeout: 60000 
  });

  const url = page.url();
  console.log(`[Runner ${RUNNER_ID}] Current URL after navigation: ${url}`);
  
  // Check if we're still on login page or dashboard
  if (url.includes('/login') || url.includes('Sign in')) {
    console.log(`[Runner ${RUNNER_ID}] Still on login page, waiting and retrying...`);
    await page.waitForTimeout(3000);
    await page.goto(`${BASE_URL}${TARGET_PATH}`, { waitUntil: 'networkidle', timeout: 60000 });
  } else if (url.includes('/Dashboard') || url.includes('/dashboard')) {
    console.log(`[Runner ${RUNNER_ID}] On Dashboard → navigating to coding page...`);
    await page.goto(`${BASE_URL}${TARGET_PATH}`, { waitUntil: 'networkidle', timeout: 60000 });
  }

  // Wait for page to fully load
  await page.waitForTimeout(3000);
  
  // Verify we're on the coding questions page
  const finalUrl = page.url();
  console.log(`[Runner ${RUNNER_ID}] Final URL: ${finalUrl}`);
  
  if (!finalUrl.includes(TARGET_PATH.replace(/^\//, ''))) {
    console.log(`[Runner ${RUNNER_ID}] Warning: May not be on correct page. Expected path: ${TARGET_PATH}`);
  }
  
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
// Extract question text
    try {
      const questionElement = page.locator(`xpath=${selectorsConfig.question_text.xpath}`);
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
      const fileButtonsContainer = page.locator(`xpath=${selectorsConfig.file_buttons_container.xpath}`);
      
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
              
              let fileCode = '';
              // Extract code from the file
              try {
                const codeElement = page.locator(`xpath=${selectorsConfig.code_multiple_files.xpath}`);
                fileCode = (await codeElement.inputValue({ timeout: 2000 })) || '';
              } catch (e) {
                console.log(`XPath approach failed for ${fileName}, trying fallback...`);
              }
              
              if (!fileCode) {
                // Fallback selectors for code extraction
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
          result.status = 'SKIPPED';
          console.log(`Failed to extract any code from multiple files for Q${questionNumber} - marking as SKIPPED`);
        }
      } else {
      const codeElement = page.locator(`xpath=${selectorsConfig.code_single_file.xpath}`);
      await codeElement.waitFor({ timeout: 2000 });
      const extractedCode = await codeElement.inputValue();
      result.code = extractedCode || 'Code not captured';
      if (!extractedCode || extractedCode.trim() === '') {
        console.log(`No code extracted for Q${questionNumber} - will still attempt to run test`);
      } else {
        console.log(`Extracted code for Q${questionNumber}: ${result.code.substring(0, 50)}...`);
      }
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
        console.log(`Could not extract code for Q${questionNumber} - will still attempt to run test: ${e.message}`);
      }
    }

    console.log(`Looking for RUN button for Q${questionNumber}...`);
    const runButtonXPath = selectorsConfig.run_button.xpath;
    
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
        `button:has-text("${selectorsConfig.run_button.text}")`,
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

    // Wait only for result to appear - no arbitrary timeout
    console.log(`Waiting for result for Q${questionNumber}...`);
    const resultXPath = selectorsConfig.result.xpath;
    
    let resultFound = false;
    
    // Try primary XPath if configured - wait for result element to appear
    if (resultXPath && resultXPath.trim() !== '') {
      try {
        // Wait for result element to appear (up to 15 seconds)
        await page.waitForSelector(`xpath=${resultXPath}`, { timeout: 15000, state: 'visible' });
        const resultElement = page.locator(`xpath=${resultXPath}`);
        
        // Wait for "Processing..." to complete and change to actual result
        let resultText = await resultElement.textContent();
        let attempts = 0;
        const maxAttempts = 15; // Wait up to 15 seconds (1 second intervals)
        
        while (attempts < maxAttempts && resultText && resultText.trim().toLowerCase().includes('processing')) {
          console.log(`[Runner ${RUNNER_ID}] Still processing... waiting for result (attempt ${attempts + 1}/${maxAttempts})`);
          await page.waitForTimeout(1000);
          resultText = await resultElement.textContent();
          attempts++;
        }
        
        if (resultText) {
          const trimmedText = resultText.trim();
          const lowerText = trimmedText.toLowerCase();
          console.log(`[Runner ${RUNNER_ID}] Result text found: "${trimmedText}"`);
          
          if (lowerText.includes('congratulations') || lowerText.includes('correct') || lowerText.includes('passed')) {
            result.status = 'PASSED';
            console.log(`✓ Passed Q${questionNumber} - Result: "${trimmedText}"`);
            resultFound = true;
          } else if (lowerText.includes('wrong answer') || lowerText.includes('incorrect') || lowerText.includes('failed')) {
            result.status = 'FAILED';
            console.log(`✗ Failed Q${questionNumber} - Result: "${trimmedText}"`);
            resultFound = true;
          } else if (lowerText.includes('processing')) {
            console.log(`⚠ Still processing for Q${questionNumber} after ${maxAttempts} seconds`);
          } else {
            console.log(`? Unknown result for Q${questionNumber}: "${trimmedText}"`);
          }
        }
      } catch (e) {
        console.log(`Primary result XPath failed for Q${questionNumber}: ${e.message}`);
      }
    }
    
    // If not found, try multiple fallback methods
    if (!resultFound) {
      console.log(`Trying fallback methods to detect result for Q${questionNumber}...`);
      
      // Method 1: Check for success messages
      const successSelectors = [
        'text=/Congratulations/i',
        'text=/Correct/i',
        'text=/Passed/i',
        'text=/Success/i',
        '[class*="success"]',
        '[class*="correct"]',
        '[class*="passed"]',
        'h5:has-text("Congratulations")',
        'h5:has-text("Correct")',
        '*:has-text("Congratulations")',
        '*:has-text("Correct")'
      ];
      
      for (const selector of successSelectors) {
        try {
          const element = page.locator(selector).first();
          if (await element.isVisible({ timeout: 2000 })) {
            const text = await element.textContent();
            if (text) {
              const lowerText = text.toLowerCase();
              if (lowerText.includes('congratulations') || lowerText.includes('correct') || lowerText.includes('passed')) {
                result.status = 'PASSED';
                console.log(`Passed Q${questionNumber} (found via selector: ${selector}) - ${text.trim()}`);
                resultFound = true;
                break;
              }
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      // Method 2: Check for failure messages
      if (!resultFound) {
        const failureSelectors = [
          'text=/Wrong Answer/i',
          'text=/Incorrect/i',
          'text=/Failed/i',
          'text=/Error/i',
          '[class*="error"]',
          '[class*="failed"]',
          '[class*="incorrect"]',
          'h5:has-text("Wrong Answer")',
          'h5:has-text("Incorrect")',
          '*:has-text("Wrong Answer")',
          '*:has-text("Incorrect")'
        ];
        
        for (const selector of failureSelectors) {
          try {
            const element = page.locator(selector).first();
            if (await element.isVisible({ timeout: 2000 })) {
              const text = await element.textContent();
              if (text) {
                const lowerText = text.toLowerCase();
                if (lowerText.includes('wrong answer') || lowerText.includes('incorrect') || lowerText.includes('failed')) {
                  result.status = 'FAILED';
                  console.log(`Failed Q${questionNumber} (found via selector: ${selector}) - ${text.trim()}`);
                  resultFound = true;
                  break;
                }
              }
            }
          } catch (e) {
            continue;
          }
        }
      }
      
      // Method 3: Check all visible text on the page for result keywords
      if (!resultFound) {
        try {
          const pageText = await page.textContent('body');
          if (pageText) {
            const lowerText = pageText.toLowerCase();
            if (lowerText.includes('congratulations!') || lowerText.includes('correct')) {
              result.status = 'PASSED';
              console.log(`Passed Q${questionNumber} (found in page text)`);
              resultFound = true;
            } else if (lowerText.includes('wrong answer') || lowerText.includes('incorrect')) {
              result.status = 'FAILED';
              console.log(`Failed Q${questionNumber} (found in page text)`);
              resultFound = true;
            }
          }
        } catch (e) {
          console.log(`Could not read page text: ${e.message}`);
        }
      }
    }
    
    // If still not found, mark as skipped
    if (!resultFound) {
      result.status = 'SKIPPED';
      console.log(`Skipped Q${questionNumber} (could not determine result - may need to check manually)`);
    }

    // Even if code was not captured, still try to run the test
    // (code might already be in the editor from previous run)
    if (result.code === 'Code not captured' || result.code === 'Code not captured from multiple files') {
      console.log(`Q${questionNumber} - Code not captured, but will still attempt to run test`);
    }

  } catch (err) {
    result.status = 'FAILED';
    result.errorMessage = err.message;
    console.error(`Error in Q${questionNumber}: ${err.message}`);
  }

  reportGenerator.addResult(result);
  return result;
}

test('Solve all coding questions', async ({ page, context }, testInfo) => {
  const reportGenerator = new ReportGenerator();
  const geminiAnalyzer = new GeminiAnalyzer();
  const runTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  
  // Use runner-specific report name if multiple runners
  const runReportName = RUNNERS > 1 
    ? `report${RUNNER_ID}.xlsx`
    : `report-${runTimestamp}.xlsx`;
  
  console.log(`\n=== Runner ${RUNNER_ID}/${RUNNERS} ===`);
  if (RUNNERS > 1) {
    console.log(`Using report file: ${runReportName}`);
  }
  
  let reportGenerated = false;
  
  const generatePartialReport = () => {
    if (!reportGenerated && reportGenerator.results.length > 0) {
      console.log('\n\n=== Test Interrupted - Generating Partial Report ===');
      try {
        const reportPath = reportGenerator.generateExcelReport(runReportName);
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

  // For runners 2+, wait for Runner 1 to create session file
  if (RUNNERS > 1 && RUNNER_ID > 1) {
    console.log(`[Runner ${RUNNER_ID}] Waiting for Runner 1 to create session file...`);
    await waitForSessionFile();
    // Wait a bit more to ensure file is fully written
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Clear browser cache/cookies to ensure clean state
    console.log(`[Runner ${RUNNER_ID}] Clearing browser cache and cookies...`);
    const context = page.context();
    await context.clearCookies();
    await context.clearPermissions();
    
    console.log(`[Runner ${RUNNER_ID}] Session file ready. Storage state should be loaded via fixture.`);
  }

  // First, verify we're logged in by going to base URL
  console.log(`[Runner ${RUNNER_ID}] Verifying login status...`);
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 60000 });

  const isLoggedIn = await page.locator('text=Dashboard').isVisible({ timeout: 10000 }).catch(() => false);
  const currentUrl = page.url();
  console.log(`[Runner ${RUNNER_ID}] Current URL: ${currentUrl}`);
  console.log(`[Runner ${RUNNER_ID}] Is logged in: ${isLoggedIn}`);
  
  // If not logged in or on login page, perform login
  if (!isLoggedIn || currentUrl.includes('/login') || currentUrl.includes('Sign in') || currentUrl.includes('accounts.google.com')) {
    console.log(`[Runner ${RUNNER_ID}] Not logged in or on login page. Performing login...`);
    await loginToApp(page, context);
    
    // After login, verify we're on dashboard (with retries)
    let verifyLogin = false;
    for (let retry = 0; retry < 3; retry++) {
      await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(3000);
      
      verifyLogin = await page.locator('text=Dashboard').isVisible({ timeout: 10000 }).catch(() => false);
      if (verifyLogin) {
        break;
      }
      console.log(`[Runner ${RUNNER_ID}] Login verification attempt ${retry + 1}/3 failed, retrying...`);
    }
    
    if (!verifyLogin) {
      console.log(`[Runner ${RUNNER_ID}] Login verification failed after retries. Current URL: ${page.url()}`);
      // Don't throw error, just log and continue - might still work
      console.log(`[Runner ${RUNNER_ID}] Continuing anyway, will check again at navigation...`);
    } else {
      console.log(`[Runner ${RUNNER_ID}] Login verified. On dashboard.`);
    }
  } else {
    console.log(`[Runner ${RUNNER_ID}] Session loaded successfully! Already logged in.`);
  }

  // Now navigate to coding questions page
  await navigateToCodingQuestions(page);

  try { 
  const totalQuestions = await detectTotalQuestions(page);
  console.log(`Total questions detected: ${totalQuestions}`);
  
  // Calculate question range for this runner
  let runnerStartFrom = START_FROM_QUESTION;
  let runnerEndTo = END_TO_QUESTION ? Math.min(END_TO_QUESTION, totalQuestions) : totalQuestions;
  
  if (RUNNERS > 1) {
    const totalQuestionsToProcess = runnerEndTo - runnerStartFrom + 1;
    const questionsPerRunner = Math.ceil(totalQuestionsToProcess / RUNNERS);
    runnerStartFrom = START_FROM_QUESTION + (RUNNER_ID - 1) * questionsPerRunner;
    runnerEndTo = Math.min(runnerStartFrom + questionsPerRunner - 1, runnerEndTo);
    
    console.log(`\n=== Runner ${RUNNER_ID}/${RUNNERS} - Question Distribution ===`);
    console.log(`Total questions: ${totalQuestionsToProcess}`);
    console.log(`Questions per runner: ~${questionsPerRunner}`);
    console.log(`This runner will process: Q${runnerStartFrom} to Q${runnerEndTo} (${runnerEndTo - runnerStartFrom + 1} questions)`);
  }
  
  const effectiveEndTo = runnerEndTo;
  const effectiveStartFrom = runnerStartFrom;
  console.log(`\n=== Processing range: Q${effectiveStartFrom} to Q${effectiveEndTo} ===`);

    console.log(`\n=== Resuming from Q${effectiveStartFrom} ===`);
    const navigationSuccess = await navigateToQuestion(page, effectiveStartFrom);
  if (!navigationSuccess) {
      console.log(`Failed to navigate to Q${effectiveStartFrom}, trying fallback...`);
      await page.getByRole('button', { name: `Q${effectiveStartFrom}`, exact: true }).click();
  }
    console.log(`Starting with Q${effectiveStartFrom}...`);

    for (let i = effectiveStartFrom; i <= effectiveEndTo; i++) {
    console.log(`\n=== Processing Q${i} ===`);
    
      if (i > effectiveStartFrom) {
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
          try { reportGenerator.generateExcelReport(runReportName); } catch (e) { console.error('Incremental report save failed:', (e as any).message); }
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
      const projectName = testInfo.project?.name || '';
      const skipAI = projectName === 'no-ai';
      
      if (skipAI) {
        console.log(`\n=== Skipping Gemini Analysis for Q${i} (AI disabled) ===`);
        const currentResult = reportGenerator.results[reportGenerator.results.length - 1];
        if (currentResult) {
          currentResult.geminiStatus = 'SKIPPED';
          currentResult.geminiRemarks = 'Skipped - AI analysis disabled';
        }
      } else {
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
              
              // Increased timeout to 60s for large code analysis
              const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Gemini analysis timeout after 60s')), 60000)
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
      }
      try { reportGenerator.generateExcelReport(runReportName); } catch (e) { console.error('Incremental report save failed:', (e as any).message); }
    
    if (i < effectiveEndTo) {
      const nextQuestionExists = await verifyNextQuestionExists(page, i);
      
      if (!nextQuestionExists) {
        console.log(`No more questions after Q${i}. Completed all available questions!`);
        break;
      }
      
      console.log(`Looking for NEXT button to move to Q${i + 1}...`);
      
      const nextButtonSelectors = [
        selectorsConfig.next_button.xpath,
        `button:has-text("${selectorsConfig.next_button.text}")`,
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
    const reportPath = reportGenerator.generateExcelReport(runReportName);
    const summary = reportGenerator.getSummary();
    reportGenerated = true;

    console.log('\n=== RUNNER SUMMARY ===');
    console.log(`Runner: ${RUNNER_ID}/${RUNNERS}`);
    console.log(`Total: ${summary.total}`);
    console.log(`Passed: ${summary.passed}`);
    console.log(`Failed: ${summary.failed}`);
    console.log(`Success Rate: ${summary.successRate}%`);
    console.log(`Report: ${reportPath}`);
    
    // Merge reports if multiple runners
    if (RUNNERS > 1) {
      console.log(`\n=== Waiting for all runners to complete before merging... ===`);
      // Wait a bit for other runners to finish
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const reportFiles: string[] = [];
      for (let i = 1; i <= RUNNERS; i++) {
        reportFiles.push(`report${i}.xlsx`);
      }
      
      // Check if all report files exist
      const reportsDir = path.join(__dirname, '..', 'reports');
      const allReportsExist = reportFiles.every(file => {
        const filePath = path.join(reportsDir, file);
        return fs.existsSync(filePath);
      });
      
      if (allReportsExist) {
        const mergedReportName = `report-${runTimestamp}.xlsx`;
        const mergedPath = ReportGenerator.mergeReports(reportFiles, mergedReportName);
        console.log(`\n=== Merged Report Created ===`);
        console.log(`Merged ${reportFiles.length} reports into: ${mergedPath}`);
        
        // Optionally clean up individual reports
        // for (const file of reportFiles) {
        //   const filePath = path.join(reportsDir, file);
        //   if (fs.existsSync(filePath)) {
        //     fs.unlinkSync(filePath);
        //   }
        // }
      } else {
        console.log(`\n=== Not all reports ready yet. Run merge manually or wait for all runners. ===`);
        console.log(`Expected reports: ${reportFiles.join(', ')}`);
      }
    }
      } catch (error) {
    console.error('\n=== Test interrupted or failed ===');
    console.error(`Error: ${error.message}`);
    
    // Generate partial report if we have any results
    if (reportGenerator.results.length > 0) {
      console.log('\n=== Generating Partial Report with Available Data ===');
      const reportPath = reportGenerator.generateExcelReport(runReportName);
      const summary = reportGenerator.getSummary();
      reportGenerated = true;

      console.log('\n=== PARTIAL SUMMARY ===');
      console.log(`Runner: ${RUNNER_ID}/${RUNNERS}`);
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
  const reportPath = reportGenerator.generateExcelReport(runReportName);
  const summary = reportGenerator.getSummary();

        console.log('\n=== FINAL SUMMARY ===');
        console.log(`Runner: ${RUNNER_ID}/${RUNNERS}`);
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
