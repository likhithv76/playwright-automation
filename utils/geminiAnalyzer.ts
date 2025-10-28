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
You are an expert HTML/CSS/JS evaluator. Your goal is to:
1. Verify whether the student's code exactly satisfies the question requirements.
2. If not, generate an updated version of the requirements that matches what the student actually implemented — useful for student feedback.

Be precise, strict, and brief.

---

QUESTION DETAILS:
${questionText}

---

CODE SUBMISSION:
${codeContent}

---

Evaluation Rules:
1. Mark as "MATCH" only if the code fully satisfies every requirement (HTML elements, structure, attributes, CSS property names and values, layout logic, and text content).
2. Mark as "PARTIAL" if minor requirements are missing, incomplete, or incorrect.
3. Mark as "DOESNT_MATCH" if most or key requirements are missing or incorrect.
4. "remarks" must be a short factual summary (under 25 words).
5. If status ≠ "MATCH", create "updated_requirements" that describe what the student's code *actually* does — in clear instructional form, ordered as per the code.
   Example: If the student used a <div> with a specific class and style, describe that in simple teacher-friendly language.
6. Never explain your reasoning, and do not include text outside the JSON object.

---

Reply strictly in JSON format:
{
  "status": "MATCH" | "PARTIAL" | "DOESNT_MATCH",
  "remarks": "short factual explanation",
  "updated_requirements": ["list of 1–5 requirements describing the student's code, or empty array if MATCH"]
}
`;


          const result = await model.generateContent(prompt);
          const response = result.response;
          const rawText = response.text().trim();
          
          let status = 'NEEDS_REVIEW';
          let remarks = rawText;
          
          let updatedRequirements: string[] | undefined = undefined;
          try {
            const jsonMatch = rawText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              status = parsed.status || status;
              remarks = parsed.remarks || remarks;
              if (parsed.updated_requirements && Array.isArray(parsed.updated_requirements)) {
                updatedRequirements = parsed.updated_requirements;
              }
            } else {
              const lowerText = rawText.toLowerCase();
              if (lowerText.includes('match confirmed') || lowerText.includes('matches well') || lowerText.includes('correct')) {
                status = 'MATCH';
              } else if (lowerText.includes("doesn't match") || lowerText.includes('wrong') || lowerText.includes('incorrect')) {
                status = 'DOESNT_MATCH';
              } else if (lowerText.includes('partial') || lowerText.includes('mostly')) {
                status = 'PARTIAL';
              }
              remarks = rawText;
            }
          } catch (e) {
            const lowerText = rawText.toLowerCase();
            if (lowerText.includes('match confirmed') || lowerText.includes('matches well')) {
              status = 'MATCH';
            } else if (lowerText.includes("doesn't match") || lowerText.includes('wrong')) {
              status = 'DOESNT_MATCH';
            } else if (lowerText.includes('partial')) {
              status = 'PARTIAL';
            }
            remarks = rawText;
          }

          const isValid = !remarks.toLowerCase().includes('skip') && 
                          !remarks.toLowerCase().includes('not configured');

          console.log(`✓ Gemini analysis successful using ${modelName} (attempt ${attempt})`);
          
          return {
            status,
            remarks: remarks,
            isValid,
            updatedRequirements: status === 'MATCH' ? undefined : updatedRequirements
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

