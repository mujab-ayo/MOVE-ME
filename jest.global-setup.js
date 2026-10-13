const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

function extractHost(url) {
  if (!url) return null;
  const match = url.match(/@([^/?:]+)/);
  return match ? match[1] : null;
}

module.exports = async function globalSetup() {
  // 1. Read .env and .env.test with dotenv.parse(fs.readFileSync(...)) and extract HOST
  const envPath = path.resolve(__dirname, '.env');
  const envTestPath = path.resolve(__dirname, '.env.test');

  const envRaw = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const envTestRaw = fs.existsSync(envTestPath) ? fs.readFileSync(envTestPath, 'utf8') : '';

  const envConfig = dotenv.parse(envRaw);
  const envTestConfig = dotenv.parse(envTestRaw);

  const envHost = extractHost(envConfig.DATABASE_URL);
  const envTestHost = extractHost(envTestConfig.DATABASE_URL);

  // 2. Call dotenv.config({ path: '.env.test' }) so process.env.DATABASE_URL holds what tests actually use
  dotenv.config({ path: '.env.test' });

  const activeHost = extractHost(process.env.DATABASE_URL);

  // 3. Abort with a clear Error if ANY of the checks fail

  // Check 1: NODE_ENV is not 'test'
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      `Check failed: NODE_ENV is not 'test' (current value: '${process.env.NODE_ENV}'). ` +
      `Ensure tests run with NODE_ENV=test and open a fresh terminal.`
    );
  }

  // Check 2: HOLD_MINUTES is set in process.env
  if (process.env.HOLD_MINUTES !== undefined && process.env.HOLD_MINUTES !== '') {
    throw new Error(
      `Check failed: HOLD_MINUTES is set in process.env (current value: '${process.env.HOLD_MINUTES}'). ` +
      `Leftover HOLD_MINUTES in the environment affects test execution.\n` +
      `To fix this, run:\n` +
      `  Remove-Item Env:HOLD_MINUTES\n` +
      `and open a fresh terminal.`
    );
  }

  // Check 3: the host in .env.test equals the host in .env
  if (envTestHost && envHost && envTestHost === envHost) {
    throw new Error(
      `Check failed: The database host in .env.test ('${envTestHost}') equals the host in .env ('${envHost}'). ` +
      `Test runs must not target the production/development database branch.`
    );
  }

  // Check 4: the host in process.env.DATABASE_URL differs from the host in .env.test
  if (!activeHost || activeHost !== envTestHost) {
    throw new Error(
      `Check failed: The active host in process.env.DATABASE_URL ('${activeHost || 'none'}') differs from the host in .env.test ('${envTestHost || 'none'}'). ` +
      `A leftover DATABASE_URL in the shell environment is overriding .env.test.\n` +
      `To fix this, run:\n` +
      `  Remove-Item Env:DATABASE_URL\n` +
      `and open a fresh terminal.`
    );
  }

  // 5. If all checks pass, print "Running tests against host: <host>" once per run
  console.log(`Running tests against host: ${activeHost}`);
};
