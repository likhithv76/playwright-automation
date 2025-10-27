import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

export interface CodeFile {
  fileName: string;
  code: string;
}

export interface QuestionResult {
  questionNumber: string;
  questionText: string;
  code: string; // Will contain formatted code from all files
  codeFiles?: CodeFile[]; // Detailed breakdown by file
  status: 'PASSED' | 'FAILED' | 'SKIPPED';
  errorMessage?: string;
  timestamp: string;
  geminiStatus?: string;  // Short keyword: MATCH, DOESNT_MATCH, PARTIAL, etc.
  geminiRemarks?: string; // Full detailed remarks
}

export class ReportGenerator {
  public results: QuestionResult[] = [];

  addResult(result: QuestionResult) {
    this.results.push(result);
  }

  generateExcelReport(customFilename?: string) {
    // Create workbook
    const workbook = XLSX.utils.book_new();

    // Prepare data for Excel
    const excelData = this.results.map(result => {
      // Add file indicator to code column if multiple files exist
      let codeValue = result.code;
      if (result.codeFiles && result.codeFiles.length > 1) {
        codeValue = `[${result.codeFiles.length} files] ${codeValue}`;
      }
      
      return {
        'Question Number': result.questionNumber,
        'Question Text': result.questionText,
        'Code': codeValue,
        'Status': result.status,
        'Error Message': result.errorMessage || '',
        'Timestamp': result.timestamp,
        'Gemini Status': result.geminiStatus || '',
        'Gemini Remarks': result.geminiRemarks || ''
      };
    });

    // Create worksheet
    const worksheet = XLSX.utils.json_to_sheet(excelData);

    // Set column widths
    const columnWidths = [
      { wch: 15 }, // Question Number
      { wch: 50 }, // Question Text
      { wch: 80 }, // Code
      { wch: 12 }, // Status
      { wch: 30 }, // Error Message
      { wch: 20 }, // Timestamp
      { wch: 15 }, // Gemini Status
      { wch: 150 }  // Gemini Remarks (increased for full text)
    ];
    worksheet['!cols'] = columnWidths;

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Coding Questions Report');

    // Create reports directory if it doesn't exist
    const reportsDir = path.join(process.cwd(), 'reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    // Generate filename with timestamp if not provided
    let filename = customFilename;
    if (!filename) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      filename = `report-${timestamp}.xlsx`;
    }

    // Write file
    const filePath = path.join(reportsDir, filename);
    XLSX.writeFile(workbook, filePath);

    console.log(`Excel report generated: ${filePath}`);
    return filePath;
  }

  getSummary() {
    const total = this.results.length;
    const passed = this.results.filter(r => r.status === 'PASSED').length;
    const failed = this.results.filter(r => r.status === 'FAILED').length;
    const skipped = this.results.filter(r => r.status === 'SKIPPED').length;

    return {
      total,
      passed,
      failed,
      skipped,
      successRate: total > 0 ? ((passed / total) * 100).toFixed(2) : '0.00'
    };
  }
}
