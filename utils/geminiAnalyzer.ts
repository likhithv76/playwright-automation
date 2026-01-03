import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';

dotenv.config();

export interface GeminiAnalysis {
  status: string;
  remarks: string;
  isValid: boolean;
  updatedRequirements?: string[];
}

export class GeminiAnalyzer {
  private genAI: GoogleGenerativeAI | null = null;
  private maxRetries = 3;
  private retryDelay = 2000;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    
    if (!apiKey) {
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

    const models = ['gemini-2.5-flash'];
    let lastError: any = null;

    for (const modelName of models) {
      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        try {
          const model = this.genAI.getGenerativeModel({ model: modelName });

          let codeContent = '';
          if (codeFiles && codeFiles.length > 0) {
            codeContent = codeFiles.map(file => 
              `FILE: ${file.fileName}\n\`\`\`\n${file.code}\n\`\`\``
            ).join('\n\n');
          } else {
            codeContent = `\`\`\`\n${code}\n\`\`\``;
          }

          const prompt = `
You are an expert HTML/CSS/JS code analyzer. Your goal is to extract ALL requirements that are present in the code and describe them in a clear, student-friendly way.

Analyze the code thoroughly and identify:
1. All HTML elements, their structure, attributes, classes, and IDs
2. All CSS properties, values, selectors, and styling rules
3. All JavaScript functionality, event handlers, and logic
4. All text content, labels, and user-facing elements
5. All layout structures, positioning, and responsive features
6. All interactive features and behaviors

Requirements:
- Extract EVERY requirement present in the code - do not miss anything
- Describe each requirement in simple, student-friendly language
- Use clear instructional language as if explaining to a student
- Order requirements logically (top to bottom, or by functionality)
- Be specific about elements, classes, properties, and values
- Include all details: attributes, styles, text content, behaviors
- For CSS values, use the EXACT values from the code (e.g., #eebbcc, not "pink"; 20px, not "twenty pixels"; rgba(255,0,0,0.5), not "semi-transparent red")

Example format:
- "Create a header element with the class 'main-header' and text 'Welcome'"
- "Style the header with background color #eebbcc and text color #ffffff"
- "Add a button with id 'submit-btn' that triggers an alert on click"

---

QUESTION DETAILS:
${questionText}

---

CODE SUBMISSION:
${codeContent}

---

Reply strictly in JSON format:
{
  "updated_requirements": ["list of ALL requirements describing what the student's code actually does, in student-friendly language - must include EVERY requirement present in the code"]
}
`;


          // Add explicit timeout wrapper
          const apiCall = model.generateContent(prompt);
          const timeout = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Gemini API call timeout after 45s')), 45000)
          );
          
          const result = await Promise.race([apiCall, timeout]);
          const response = (result as any).response;
          const rawText = response.text().trim();
          
          let updatedRequirements: string[] | undefined = undefined;
          try {
            const jsonMatch = rawText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              if (parsed.updated_requirements && Array.isArray(parsed.updated_requirements)) {
                updatedRequirements = parsed.updated_requirements;
              }
            }
          } catch (e) {
            // If JSON parsing fails, try to extract requirements from text
            const lines = rawText.split('\n');
            updatedRequirements = [];
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed && !trimmed.startsWith('{') && !trimmed.startsWith('}')) {
                const cleaned = trimmed.replace(/^[-*]\s*/, '').replace(/^\d+\.\s*/, '');
                if (cleaned.length > 10) {
                  updatedRequirements.push(cleaned);
                }
              }
            }
          }

          const isValid = updatedRequirements !== undefined && 
                          updatedRequirements.length > 0;

          console.log(`✓ Gemini analysis successful using ${modelName} (attempt ${attempt})`);
          
          return {
            status: 'SUCCESS',
            remarks: `Extracted ${updatedRequirements?.length || 0} requirements`,
            isValid,
            updatedRequirements
          };

        } catch (error) {
          lastError = error;
          
          if (this.shouldRetry(error) && attempt < this.maxRetries) {
            const delay = this.retryDelay * Math.pow(2, attempt - 1);
            console.log(`Gemini API error (attempt ${attempt}/${this.maxRetries}): ${error.message}`);
            console.log(`Retrying in ${delay/1000}s with ${modelName}...`);
            await this.sleep(delay);
            continue;
          }

          if (attempt >= this.maxRetries && models.indexOf(modelName) < models.length - 1) {
            console.log(`All retries failed for ${modelName}, trying next model...`);
            break;
          }
        }
      }
    }

    console.error('All Gemini models failed after retries');
    return {
      status: 'ERROR',
      remarks: `Analysis failed: ${lastError ? lastError.message : 'Unknown error'}. Service may be overloaded.`,
      isValid: false
    };
  }
}

