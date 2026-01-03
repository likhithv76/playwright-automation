import { spawn } from 'child_process';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const RUNNERS = parseInt(process.env.RUNNERS || '1');
const BASE_CMD = process.argv[2] || 'start:headed';
const isHeadless = BASE_CMD.includes('headless');
const isNoAI = BASE_CMD.includes('no-ai');

if (RUNNERS <= 1) {
  console.log('RUNNERS is 1 or not set. Running single instance...');
  process.exit(0);
}

console.log(`\n=== Starting ${RUNNERS} parallel runners ===\n`);

const runners: Promise<number>[] = [];

for (let i = 1; i <= RUNNERS; i++) {
  const runnerEnv = {
    ...process.env,
    RUNNER_ID: i.toString(),
    RUNNERS: RUNNERS.toString(),
  };

  const cmd = isHeadless ? 'npx' : 'npx';
  const args = [
    'playwright',
    'test',
    'tests/coding_questions.spec.ts',
    ...(isHeadless ? ['--headless'] : ['--headed']),
    ...(isNoAI ? ['--project=no-ai'] : [])
  ];

  console.log(`Starting Runner ${i}/${RUNNERS}...`);
  
  const runner = new Promise<number>((resolve) => {
    const proc = spawn(cmd, args, {
      env: runnerEnv,
      stdio: 'inherit',
      shell: true,
      cwd: process.cwd()
    });

    proc.on('close', (code) => {
      console.log(`\nRunner ${i}/${RUNNERS} finished with code ${code}`);
      resolve(code || 0);
    });

    proc.on('error', (error) => {
      console.error(`Runner ${i}/${RUNNERS} error:`, error);
      resolve(1);
    });
  });

  runners.push(runner);
  
  // Stagger starts slightly to avoid conflicts
  await new Promise(resolve => setTimeout(resolve, 1000));
}

// Wait for all runners to complete
const results = await Promise.all(runners);
const allSuccess = results.every(code => code === 0);

console.log(`\n=== All runners completed ===`);
console.log(`Results: ${results.join(', ')}`);

if (allSuccess) {
  console.log('All runners completed successfully!');
  process.exit(0);
} else {
  console.log('Some runners failed.');
  process.exit(1);
}
