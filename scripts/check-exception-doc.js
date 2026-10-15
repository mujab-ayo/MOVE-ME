#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const docPath = path.join(projectRoot, 'docs', 'exception-handling.md');

if (!fs.existsSync(docPath)) {
  console.error(`Error: Documentation file not found at ${docPath}`);
  process.exit(1);
}

// 1. Collect all *.test.ts files
function findTestFiles(dir) {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name !== 'node_modules' &&
        entry.name !== '.git' &&
        entry.name !== 'dist' &&
        entry.name !== '.gemini'
      ) {
        results = results.concat(findTestFiles(fullPath));
      }
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

const testFiles = findTestFiles(projectRoot);
const testFileContents = testFiles.map((filePath) => ({
  path: filePath,
  relativePath: path.relative(projectRoot, filePath).replace(/\\/g, '/'),
  content: fs.readFileSync(filePath, 'utf8'),
}));

// 2. Read and parse docs/exception-handling.md
const docContent = fs.readFileSync(docPath, 'utf8');
const lines = docContent.split('\n');

const citedTests = [];

for (let i = 0; i < lines.length; i++) {
  const rawLine = lines[i];
  const trimmed = rawLine.trim();

  // Process markdown table rows
  if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
    const cols = trimmed.split('|').map((c) => c.trim());
    // Table format: | Endpoint | Trigger / Condition | HTTP Status | Response Message / Body | Proving Test | Status |
    // Split yields: ["", "Endpoint", "Trigger...", "HTTP...", "Response...", "Proving Test", "Status", ""]
    if (cols.length >= 7) {
      const status = cols[6].replace(/\*/g, '').trim();
      const provingCol = cols[5];

      if (status.toLowerCase() === 'tested') {
        const matches = provingCol.match(/"([^"]+)"/g);
        if (matches && matches.length > 0) {
          for (const m of matches) {
            const testName = m.slice(1, -1).trim();
            citedTests.push({
              testName,
              line: i + 1,
              endpoint: cols[1],
            });
          }
        } else {
          console.error(
            `Error: Row at line ${i + 1} marked 'Tested' but no quoted test name found: ${provingCol}`
          );
          process.exit(1);
        }
      }
    }
  }
}

if (citedTests.length === 0) {
  console.error('Error: No cited tests found in docs/exception-handling.md');
  process.exit(1);
}

// 3. Verify that every cited test name is present verbatim in at least one *.test.ts file
const missing = [];
const verified = [];

for (const cited of citedTests) {
  const match = testFileContents.find((f) => f.content.includes(cited.testName));
  if (match) {
    verified.push({
      testName: cited.testName,
      endpoint: cited.endpoint,
      file: match.relativePath,
    });
  } else {
    missing.push(cited);
  }
}

if (missing.length > 0) {
  console.error(
    `\nFAILURE: Found ${missing.length} cited test name(s) in docs/exception-handling.md missing verbatim in *.test.ts files:\n`
  );
  for (const m of missing) {
    console.error(`  - [Line ${m.line}] ${m.endpoint} -> "${m.testName}"`);
  }
  console.error('\nPlease update docs/exception-handling.md or the test files so names match verbatim.\n');
  process.exit(1);
}

console.log(
  `SUCCESS: All ${verified.length} cited test names in docs/exception-handling.md verified verbatim across ${testFiles.length} *.test.ts files.`
);
process.exit(0);
