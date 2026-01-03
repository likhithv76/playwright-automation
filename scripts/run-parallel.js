const { spawn } = require('child_process');
const path = require('path');
require('dotenv').config();

const RUNNERS = parseInt(process.env.RUNNERS || '1');
const command = process.argv[2] || 'start:headed';
const isHeadless = command.includes('headless');
const isNoAI = command.includes('no-ai');

if (RUNNERS <= 1) {
  console.log('RUNNERS is 1 or not set. Running single instance...');
  const args = [
    'playwright',
    'test',
    'tests/coding_questions.spec.ts',
    ...(isHeadless ? ['--headless'] : ['--headed']),
    ...(isNoAI ? ['--project=no-ai'] : [])
  ];
  
  const proc = spawn('npx', args, {
    env: process.env,
    stdio: 'inherit',
    shell: true,
    cwd: process.cwd()
  });
  
  proc.on('close', (code) => {
    process.exit(code || 0);
  });
  
  proc.on('error', (error) => {
    console.error('Error:', error);
    process.exit(1);
  });
  
  return;
}

console.log(`\n=== Starting ${RUNNERS} parallel runners ===\n`);

(async function() {
  const runners = [];

  for (let i = 1; i <= RUNNERS; i++) {
    const runnerEnv = {
      ...process.env,
      RUNNER_ID: i.toString(),
      RUNNERS: RUNNERS.toString(),
    };

    const args = [
      'playwright',
      'test',
      'tests/coding_questions.spec.ts',
      ...(isHeadless ? ['--headless'] : ['--headed']),
      ...(isNoAI ? ['--project=no-ai'] : [])
    ];

    console.log(`Starting Runner ${i}/${RUNNERS}...`);
    
    const runner = new Promise((resolve) => {
      const proc = spawn('npx', args, {
        env: runnerEnv,
        stdio: 'inherit',
        shell: true,
        cwd: process.cwd()
      });

      proc.on('close', (code) => {
        console.log(`\nRunner ${i}/${RUNNERS} finished with code ${code || 0}`);
        resolve(code || 0);
      });

      proc.on('error', (error) => {
        console.error(`Runner ${i}/${RUNNERS} error:`, error);
        resolve(1);
      });
    });

    runners.push(runner);
    
    // Stagger starts slightly to avoid conflicts
    if (i < RUNNERS) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
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
})().catch(error => {
  console.error('Error starting runners:', error);
  process.exit(1);
});
