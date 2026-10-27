#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const dotenv = require('dotenv');
const { Client } = require('pg');

const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env');
const envTestPath = path.join(projectRoot, '.env.test');
const mapPath = path.join(projectRoot, 'docs', 'requirement-map.json');
const reportPath = path.join(projectRoot, 'docs', 'regression-results.md');

function extractHost(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    const match = url.match(/@([^/?:]+)/);
    return match ? match[1] : null;
  }
}

// 1. Safety check on database host
if (!fs.existsSync(envTestPath)) {
  console.error('Error: .env.test file not found.');
  process.exit(1);
}

const envTestRaw = fs.readFileSync(envTestPath, 'utf8');
const envRaw = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

const envTestConfig = dotenv.parse(envTestRaw);
const envConfig = dotenv.parse(envRaw);

const envTestHost = extractHost(envTestConfig.DATABASE_URL);
const envHost = extractHost(envConfig.DATABASE_URL);
const testDbUrl = envTestConfig.DATABASE_URL;
const targetHost = extractHost(testDbUrl);

if (!targetHost || targetHost !== envTestHost) {
  console.error(
    `Abort: Database target host ('${targetHost || 'none'}') does not equal host in .env.test ('${envTestHost || 'none'}').`
  );
  process.exit(1);
}

if (envHost && targetHost === envHost) {
  console.error(
    `Abort: Database target host ('${targetHost}') equals host in .env ('${envHost}'). Test database must be isolated from production/development.`
  );
  process.exit(1);
}

// 2. Read requirement map
if (!fs.existsSync(mapPath)) {
  console.error(`Error: Requirement map not found at ${mapPath}`);
  process.exit(1);
}

const requirementMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));

// 3. Run Jest with --json --outputFile=<temp file>
const tempFile = path.join(os.tmpdir(), `jest-regression-${Date.now()}-${process.pid}.json`);
const jestBin = require.resolve('jest/bin/jest');

console.log('Running test suite with Jest...');
const startTime = Date.now();

try {
  cp.spawnSync(process.execPath, [jestBin, '--json', `--outputFile=${tempFile}`], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
    },
    stdio: 'inherit',
  });
} catch (err) {
  console.error('Failed to spawn Jest process:', err);
}

const totalDurationMs = Date.now() - startTime;

if (!fs.existsSync(tempFile)) {
  console.error(`Error: Jest did not produce output file at ${tempFile}`);
  process.exit(1);
}

let jestResults;
try {
  const rawJson = fs.readFileSync(tempFile, 'utf8');
  jestResults = JSON.parse(rawJson);
} catch (err) {
  console.error('Error parsing Jest output JSON:', err);
  if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  process.exit(1);
} finally {
  if (fs.existsSync(tempFile)) {
    try {
      fs.unlinkSync(tempFile);
    } catch {
      // ignore temp cleanup error
    }
  }
}

// 4. Analyze test results
const numPassedTestSuites = jestResults.numPassedTestSuites || 0;
const numFailedTestSuites = jestResults.numFailedTestSuites || 0;
const numTotalTestSuites = jestResults.numTotalTestSuites || 0;

const numPassedTests = jestResults.numPassedTests || 0;
const numFailedTests = jestResults.numFailedTests || 0;
const numPendingTests = jestResults.numPendingTests || 0;
const numTotalTests = jestResults.numTotalTests || 0;

// Collect all failing tests
const failingTests = [];
for (const suite of jestResults.testResults || []) {
  const relPath = path.relative(projectRoot, suite.name).replace(/\\/g, '/');
  for (const assertion of suite.assertionResults || []) {
    if (assertion.status === 'failed') {
      failingTests.push({
        file: relPath,
        title: assertion.title,
        fullName: assertion.fullName,
        messages: assertion.failureMessages || [],
      });
    }
  }
}

// 5. Evaluate requirement map
function findAssertion(testResults, targetFile, targetTestName) {
  const normTargetFile = targetFile.replace(/\\/g, '/').toLowerCase();
  const suite = testResults.find((s) =>
    s.name.replace(/\\/g, '/').toLowerCase().endsWith(normTargetFile)
  );
  if (!suite) return null;

  const targetTrimmed = targetTestName.trim();
  return suite.assertionResults.find(
    (a) =>
      a.title.trim() === targetTrimmed ||
      a.fullName.trim() === targetTrimmed ||
      a.fullName.trim().endsWith(targetTrimmed)
  );
}

const mapEvaluation = [];
const missingMappedTests = [];
const failedMappedTests = [];

for (const [key, testList] of Object.entries(requirementMap)) {
  let mappedCount = testList.length;
  let passedCount = 0;
  let failedCount = 0;
  let missingCount = 0;

  for (const item of testList) {
    const assertion = findAssertion(jestResults.testResults || [], item.file, item.testName);
    if (!assertion) {
      missingMappedTests.push({ key, file: item.file, testName: item.testName });
      missingCount++;
    } else if (assertion.status === 'passed') {
      passedCount++;
    } else {
      failedMappedTests.push({
        key,
        file: item.file,
        testName: item.testName,
        status: assertion.status,
      });
      failedCount++;
    }
  }

  mapEvaluation.push({
    key,
    mapped: mappedCount,
    passed: passedCount,
    failed: failedCount,
    missing: missingCount,
    status: failedCount === 0 && missingCount === 0 ? 'PASS' : 'FAIL',
  });
}

// 6. Connect to database to fetch live constraint and index definitions
async function fetchDbMetadata() {
  // Pre-connection check
  const activeTargetHost = extractHost(testDbUrl);
  if (!activeTargetHost || activeTargetHost !== envTestHost || (envHost && activeTargetHost === envHost)) {
    throw new Error(
      `Database connection aborted: target host '${activeTargetHost}' does not match .env.test or equals .env.`
    );
  }

  const client = new Client({
    connectionString: testDbUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const constraintsQuery = `
    SELECT
      conrelid::regclass::text AS table_name,
      conname AS constraint_name,
      contype AS constraint_type,
      pg_get_constraintdef(c.oid, true) AS definition
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE t.relname IN ('departures', 'reservations', 'payments')
      AND n.nspname = 'public'
    ORDER BY table_name, constraint_name;
  `;

  const indexesQuery = `
    SELECT
      tablename,
      indexname,
      indexdef
    FROM pg_indexes
    WHERE tablename IN ('departures', 'reservations', 'payments')
      AND schemaname = 'public'
    ORDER BY tablename, indexname;
  `;

  const [constraintsRes, indexesRes] = await Promise.all([
    client.query(constraintsQuery),
    client.query(indexesQuery),
  ]);

  await client.end();

  return {
    constraints: constraintsRes.rows,
    indexes: indexesRes.rows,
  };
}

(async () => {
  let dbMetadata = { constraints: [], indexes: [] };
  try {
    dbMetadata = await fetchDbMetadata();
  } catch (err) {
    console.error('Error fetching database constraints and indexes:', err);
    process.exit(1);
  }

  // 7. Generate markdown report docs/regression-results.md
  const reportDate = new Date().toISOString();
  const runTimeSec = (totalDurationMs / 1000).toFixed(2);

  const typeDesc = {
    c: 'CHECK',
    f: 'FOREIGN KEY',
    p: 'PRIMARY KEY',
    u: 'UNIQUE',
    t: 'TRIGGER',
    x: 'EXCLUSION',
    n: 'NOT NULL',
  };

  let md = `# Regression Test Report\n\n`;
  md += `- **Date & Time:** ${reportDate}\n`;
  md += `- **Test Database Host:** \`${targetHost}\`\n`;
  md += `- **Total Run Time:** ${runTimeSec} seconds\n\n`;

  md += `## Suite & Test Totals\n\n`;
  md += `| Category | Passed | Failed | Skipped | Total |\n`;
  md += `| :--- | :---: | :---: | :---: | :---: |\n`;
  md += `| **Test Suites** | ${numPassedTestSuites} | ${numFailedTestSuites} | 0 | ${numTotalTestSuites} |\n`;
  md += `| **Tests** | ${numPassedTests} | ${numFailedTests} | ${numPendingTests} | ${numTotalTests} |\n\n`;

  md += `## Failing Tests\n\n`;
  if (failingTests.length === 0) {
    md += `None (all tests passed).\n\n`;
  } else {
    for (const ft of failingTests) {
      md += `### \`${ft.file}\` - ${ft.title}\n\n`;
      md += `\`\`\`\n${ft.messages.join('\n')}\n\`\`\`\n\n`;
    }
  }

  md += `## Requirement & Focus Area Traceability\n\n`;
  md += `| Requirement / Focus Area | Mapped Tests | Passed | Failed | Missing | Status |\n`;
  md += `| :--- | :---: | :---: | :---: | :---: | :---: |\n`;
  for (const row of mapEvaluation) {
    md += `| **${row.key}** | ${row.mapped} | ${row.passed} | ${row.failed} | ${row.missing} | ${row.status} |\n`;
  }
  md += `\n`;

  md += `## Live Database Constraints & Indexes\n\n`;
  md += `Live catalog definitions extracted from PostgreSQL host \`${targetHost}\` for tables \`departures\`, \`reservations\`, and \`payments\`.\n\n`;

  md += `### Constraints (\`pg_get_constraintdef\`)\n\n`;
  md += `| Table | Constraint Name | Type | Definition |\n`;
  md += `| :--- | :--- | :---: | :--- |\n`;
  for (const c of dbMetadata.constraints) {
    const t = typeDesc[c.constraint_type] || c.constraint_type;
    const cleanDef = c.definition.replace(/\|/g, '\\|');
    md += `| \`${c.table_name}\` | \`${c.constraint_name}\` | ${t} | \`${cleanDef}\` |\n`;
  }
  md += `\n`;

  md += `### Indexes (\`pg_indexes\`)\n\n`;
  md += `| Table | Index Name | Index Definition |\n`;
  md += `| :--- | :--- | :--- |\n`;
  for (const idx of dbMetadata.indexes) {
    const cleanDef = idx.indexdef.replace(/\|/g, '\\|');
    md += `| \`${idx.tablename}\` | \`${idx.indexname}\` | \`${cleanDef}\` |\n`;
  }
  md += `\n`;

  fs.writeFileSync(reportPath, md, 'utf8');
  console.log(`Regression report successfully written to ${reportPath}`);

  // 8. Exit code logic
  let hasFailure = false;

  if (numFailedTests > 0 || numFailedTestSuites > 0) {
    console.error(`\nFAILURE: ${numFailedTests} test(s) failed in the test suite.`);
    hasFailure = true;
  }

  if (missingMappedTests.length > 0) {
    console.error(
      `\nFAILURE: ${missingMappedTests.length} mapped test(s) from requirement-map.json were NOT found in test results:`
    );
    for (const m of missingMappedTests) {
      console.error(`  - [${m.key}] ${m.file} -> "${m.testName}"`);
    }
    hasFailure = true;
  }

  if (failedMappedTests.length > 0) {
    console.error(`\nFAILURE: ${failedMappedTests.length} mapped test(s) did NOT pass:`);
    for (const f of failedMappedTests) {
      console.error(`  - [${f.key}] ${f.file} -> "${f.testName}" (status: ${f.status})`);
    }
    hasFailure = true;
  }

  if (hasFailure) {
    process.exit(1);
  }

  console.log('SUCCESS: All tests passed and all requirement mappings verified.');
  process.exit(0);
})();
