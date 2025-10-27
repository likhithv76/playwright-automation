import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';

dotenv.config();

export interface GeminiAnalysis {
  status: string;  // Short keyword like "Match confirmed", "Doesn't match", etc.
  remarks: string;  // Full detailed text
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
        status: 'SKIPPED',
        remarks: 'Gemini analysis skipped - API key not configured',
        isValid: false
      };
    }

    // Try multiple models in order of preference
    const models = ['gemini-2.5-flash'];
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

          const prompt = `Does the code solve the question correctly?

Question: ${questionText.substring(0, 200)}

Code: ${codeContent.substring(0, 500)}

Reply with JSON:
{"status": "MATCH" or "DOESNT_MATCH" or "PARTIAL", "remarks": "short explanation in simple words"}`;

          const result = await model.generateContent(prompt);
          const response = result.response;
          const rawText = response.text().trim();
          
          // Try to extract JSON from the response
          let status = 'NEEDS_REVIEW';
          let remarks = rawText;
          
          try {
            // Look for JSON in the response
            const jsonMatch = rawText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              status = parsed.status || status;
              remarks = parsed.remarks || remarks;
            } else {
              // Fallback: try to infer status from text
              const lowerText = rawText.toLowerCase();
              if (lowerText.includes('match confirmed') || lowerText.includes('matches well') || lowerText.includes('correct')) {
                status = 'MATCH';
              } else if (lowerText.includes("doesn't match") || lowerText.includes('wrong') || lowerText.includes('incorrect')) {
                status = 'DOESNT_MATCH';
              } else if (lowerText.includes('partial') || lowerText.includes('mostly')) {
                status = 'PARTIAL';
              }
              // Don't truncate remarks
              remarks = rawText;
            }
          } catch (e) {
            // If parsing fails, use fallback logic
            const lowerText = rawText.toLowerCase();
            if (lowerText.includes('match confirmed') || lowerText.includes('matches well')) {
              status = 'MATCH';
            } else if (lowerText.includes("doesn't match") || lowerText.includes('wrong')) {
              status = 'DOESNT_MATCH';
            } else if (lowerText.includes('partial')) {
              status = 'PARTIAL';
            }
            // Don't truncate remarks
            remarks = rawText;
          }

          const isValid = !remarks.toLowerCase().includes('skip') && 
                          !remarks.toLowerCase().includes('not configured');

          console.log(`✓ Gemini analysis successful using ${modelName} (attempt ${attempt})`);
          
          return {
            status,
            remarks: remarks, // No truncation
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
      status: 'ERROR',
      remarks: `Analysis failed: ${lastError ? lastError.message : 'Unknown error'}. Service may be overloaded.`,
      isValid: false
    };
  }
}

