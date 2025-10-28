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
  code: string;
  codeFiles?: CodeFile[];
  status: 'PASSED' | 'FAILED' | 'SKIPPED';
  errorMessage?: string;
  timestamp: string;
  geminiStatus?: string;        
  geminiRemarks?: string;  
  geminiUpdatedRequirements?: string[] | string;
}

export class ReportGenerator {
  public results: QuestionResult[] = [];

  addResult(result: QuestionResult) {
    this.results.push(result);
  }

  generateExcelReport(customFilename?: string) {
    const workbook = XLSX.utils.book_new();

    const excelData = this.results.map(result => {
      let codeValue = result.code;
      if (result.codeFiles && result.codeFiles.length > 1) {
        codeValue = `[${result.codeFiles.length} files] ${codeValue}`;
      }

      let updatedRequirements = '';
      if (Array.isArray(result.geminiUpdatedRequirements)) {
        updatedRequirements = result.geminiUpdatedRequirements.join('\n• ');
      } else if (typeof result.geminiUpdatedRequirements === 'string') {
        updatedRequirements = result.geminiUpdatedRequirements;
      }

      return {
        'Question Number': result.questionNumber,
        'Question Text': result.questionText,
        'Code': codeValue,
        'Status': result.status,
        'Error Message': result.errorMessage || '',
        'Timestamp': result.timestamp,
        'Gemini Status': result.geminiStatus || '',
        'Gemini Remarks': result.geminiRemarks || '',
        'Gemini Updated Requirements': updatedRequirements || ''
      };
    });
    
    const worksheet = XLSX.utils.json_to_sheet(excelData);

    const columnWidths = [
      { wch: 15 },
      { wch: 50 },
      { wch: 80 },
      { wch: 12 },
      { wch: 30 },
      { wch: 20 },
      { wch: 15 },
      { wch: 80 },
      { wch: 100 }
    ];
    worksheet['!cols'] = columnWidths;

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Coding Questions Report');

    const reportsDir = path.join(process.cwd(), 'reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    let filename = customFilename;
    if (!filename) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      filename = `report-${timestamp}.xlsx`;
    }

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
