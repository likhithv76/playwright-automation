import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';

dotenv.config();

export interface GeminiAnalysis {
  remarks: string;
  isValid: boolean;
}

export class GeminiAnalyzer {
  private genAI: GoogleGenerativeAI | null = null;
  private maxRetries = 3;
  private retryDelay = 2000; // 2 seconds initial delay

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    
    if (!apiKey || apiKey === 'your_api_key_here') {
      console.warn('GEMINI_API_KEY not found in .env file. Gemini analysis will be skipped.');
      this.genAI = null;
    } else {
      this.genAI = new GoogleGenerativeAI(apiKey);
    }
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private shouldRetry(error: any): boolean {
    if (!error || !error.message) return false;
    
    const errorMessage = error.message.toLowerCase();
    return (
      errorMessage.includes('503') ||
      errorMessage.includes('service unavailable') ||
      errorMessage.includes('overloaded') ||
      errorMessage.includes('429') ||
      errorMessage.includes('rate limit') ||
      errorMessage.includes('timeout') ||
      errorMessage.includes('econnrefused')
    );
  }

  async analyzeQuestionAndCode(questionText: string, code: string, codeFiles?: Array<{fileName: string, code: string}>): Promise<GeminiAnalysis> {
    if (!this.genAI) {
      return {
        remarks: 'Gemini analysis skipped - API key not configured',
        isValid: false
      };
    }

    // Try multiple models in order of preference
    const models = ['gemini-2.5-flash', 'gemini-pro', 'gemini-1.5-flash'];
    let lastError: any = null;

    for (const modelName of models) {
      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        try {
          const model = this.genAI.getGenerativeModel({ model: modelName });

          // Build code content for analysis
          let codeContent = '';
          if (codeFiles && codeFiles.length > 0) {
            // If multiple files exist, format them nicely
            codeContent = codeFiles.map(file => 
              `FILE: ${file.fileName}\n\`\`\`\n${file.code}\n\`\`\``
            ).join('\n\n');
          } else {
            // Single code block
            codeContent = `\`\`\`\n${code}\n\`\`\``;
          }

          const prompt = `You are a code review assistant. Analyze if the following question text matches the provided code solution.

Question Text: "${questionText}"

Code Solution:
${codeContent}

Based on your analysis, provide:
1. A brief assessment (maximum 50 words) about whether the question matches the code
2. If they match well, say "Match confirmed"
3. If the question doesn't match the code's intent, say "Question doesn't match code"
4. If the code doesn't match the question's requirements, say "Code doesn't match question"
5. If there are other issues, provide a short constructive remark

Format your response as a single short sentence starting with your assessment.`;

          const result = await model.generateContent(prompt);
          const response = result.response;
          const remarks = response.text().trim();

          const isValid = !remarks.toLowerCase().includes('skip') && 
                          !remarks.toLowerCase().includes('not configured');

          console.log(`✓ Gemini analysis successful using ${modelName} (attempt ${attempt})`);
          
          return {
            remarks: remarks.substring(0, 200),
            isValid
          };

        } catch (error) {
          lastError = error;
          
          // Check if we should retry
          if (this.shouldRetry(error) && attempt < this.maxRetries) {
            const delay = this.retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
            console.log(`⚠️  Gemini API error (attempt ${attempt}/${this.maxRetries}): ${error.message}`);
            console.log(`   Retrying in ${delay/1000}s with ${modelName}...`);
            await this.sleep(delay);
            continue;
          }
          
          // If not retriable or last attempt, try next model
          if (attempt >= this.maxRetries && models.indexOf(modelName) < models.length - 1) {
            console.log(`✗ All retries failed for ${modelName}, trying next model...`);
            break;
          }
        }
      }
    }

    // All models failed
    console.error('✗ All Gemini models failed after retries');
    return {
      remarks: `Analysis failed: ${lastError ? lastError.message : 'Unknown error'}. Service may be overloaded.`,
      isValid: false
    };
  }
}

