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
  geminiStatus?: string;
  geminiRemarks?: string;
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

      return {
        'Question Number': result.questionNumber,
        'Question Text': result.questionText,
        'Code': codeValue,
        'Status': result.status,
        'Gemini Status': result.geminiStatus || '',
        'Gemini Remarks': result.geminiRemarks || ''
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(excelData);

    const columnWidths = [
      { wch: 15 },
      { wch: 50 },
      { wch: 80 },
      { wch: 12 },
      { wch: 15 },
      { wch: 150 }
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

    // Write file
    const filePath = path.join(reportsDir, filename);
    XLSX.writeFile(workbook, filePath);

    console.log(`Excel report generated: ${filePath}`);
    return filePath;
  }

  generateLogFile(customFilename?: string) {
    const logsDir = path.join(process.cwd(), 'Logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    let filename = customFilename;
    if (!filename) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      filename = `report-${timestamp}.log`;
    }

    const timestamp = new Date().toISOString();
    let logContent = `================================================================================
TEST EXECUTION REPORT
Generated: ${timestamp}
================================================================================

SUMMARY
--------
Total Tests: ${this.results.length}
Passed: ${this.results.filter(r => r.status === 'PASSED').length}
Failed: ${this.results.filter(r => r.status === 'FAILED').length}
Skipped: ${this.results.filter(r => r.status === 'SKIPPED').length}
Success Rate: ${this.results.length > 0 ? ((this.results.filter(r => r.status === 'PASSED').length / this.results.length) * 100).toFixed(2) : '0.00'}%

================================================================================
DETAILED RESULTS
================================================================================

`;

    this.results.forEach((result, index) => {
      logContent += `${index + 1}. Question ${result.questionNumber}
${'='.repeat(80)}

Status: ${result.status}
Gemini Status: ${result.geminiStatus || 'N/A'}
${result.geminiRemarks ? `Gemini Remarks: ${result.geminiRemarks}` : ''}

Question: ${result.questionText}

Code:
${result.code}

`;

      if (result.codeFiles && result.codeFiles.length > 1) {
        logContent += `Files (${result.codeFiles.length}):\n`;
        result.codeFiles.forEach(file => {
          logContent += `  - ${file.fileName}\n`;
        });
        logContent += '\n';
      }

      logContent += `${'='.repeat(80)}\n\n`;
    });

    const filePath = path.join(logsDir, filename);
    fs.writeFileSync(filePath, logContent, 'utf-8');

    console.log(`Log report generated: ${filePath}`);
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
