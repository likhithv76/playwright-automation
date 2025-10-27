# Playwright Automation - LMS Coding Questions

Automated testing and analysis tool for LMS coding questions with Gemini AI integration.

## Features

- ✅ Automated solving of coding questions
- ✅ Multi-file code extraction (HTML, CSS, JS)
- ✅ Gemini AI analysis with status keywords and detailed remarks
- ✅ Excel report generation with timestamps
- ✅ Resume from specific question number
- ✅ Partial report generation on interruption
- ✅ Retry logic with exponential backoff for API calls

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file:
```env
GEMINI_API_KEY=your_api_key_here
BASE_URL=https://lms.exskilence.com
TARGET_PATH=/testing/coding/cs
```

3. Run tests:
```bash
npx playwright test
```

## Usage

### Resume from Specific Question

If your test stopped at question 40 and you want to continue from there:

```bash
START_FROM=40 npx playwright test
```

Or on Windows PowerShell:
```powershell
$env:START_FROM=40; npx playwright test
```

### Environment Variables

- `START_FROM`: Question number to start from (default: 1)
- `BASE_URL`: LMS base URL (default: https://lms.exskilence.com)
- `TARGET_PATH`: Coding questions path (default: /testing/coding/cs)
- `GEMINI_API_KEY`: Your Gemini API key

### Report Files

Reports are saved in `reports/` folder with timestamps:
- Example: `report-2024-01-15T14-30-00.xlsx`

Contains:
- Question Number
- Question Text
- Code (with file indicators for multiple files)
- Test Status (PASSED/FAILED/SKIPPED)
- Error Messages
- Gemini Status (MATCH/DOESNT_MATCH/PARTIAL/NEEDS_REVIEW/ERROR/SKIPPED)
- Gemini Remarks (detailed analysis)

### Interruption Handling

If you stop the test with Ctrl+C:
- Partial report is automatically generated
- All completed questions are saved
- Summary shows completed vs total

### Time Estimates

- Per question: ~25-35 seconds (including Gemini analysis)
- Throttling: 10-second delay every 15 questions
- Total for 90 questions: ~45-60 minutes

## Gemini Analysis

The tool uses Gemini AI to analyze if questions match code solutions.

### Status Keywords:
- **MATCH**: Question and code align perfectly
- **DOESNT_MATCH**: Significant mismatch between question and code
- **PARTIAL**: Some alignment but missing elements
- **NEEDS_REVIEW**: Requires manual review
- **ERROR**: Analysis failed
- **SKIPPED**: Skipped due to insufficient data

### Features:
- Automatic retry with exponential backoff
- Multiple model fallback (gemini-2.5-flash)
- Rate limit protection with throttling
- Detailed error handling

## Project Structure

```
.
├── tests/
│   └── coding_questions.spec.ts  # Main test file
├── utils/
│   ├── geminiAnalyzer.ts         # Gemini AI integration
│   └── reportGenerator.ts        # Excel report generation
├── reports/                      # Generated reports (with timestamps)
├── playwright/
│   └── .auth/                    # Saved authentication
└── .env                          # Environment variables
```

## Notes

- Authentication is saved in `playwright/.auth/` for faster subsequent runs
- Partial reports are generated on interruption
- Multi-file questions (HTML + CSS) are automatically detected and extracted
