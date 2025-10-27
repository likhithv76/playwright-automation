import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';

dotenv.config();

export interface GeminiAnalysis {
  remarks: string;
  isValid: boolean;
}

export class GeminiAnalyzer {
  private genAI: GoogleGenerativeAI | null = null;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    
    if (!apiKey || apiKey === 'your_api_key_here') {
      console.warn('GEMINI_API_KEY not found in .env file. Gemini analysis will be skipped.');
      this.genAI = null;
    } else {
      this.genAI = new GoogleGenerativeAI(apiKey);
    }
  }

  async analyzeQuestionAndCode(questionText: string, code: string, codeFiles?: Array<{fileName: string, code: string}>): Promise<GeminiAnalysis> {
    if (!this.genAI) {
      return {
        remarks: 'Gemini analysis skipped - API key not configured',
        isValid: false
      };
    }

    try {
      const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

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

      return {
        remarks: remarks.substring(0, 200),
        isValid
      };

    } catch (error) {
      console.error('Error calling Gemini API:', error);
      return {
        remarks: `Analysis failed: ${error.message}`,
        isValid: false
      };
    }
  }
}

