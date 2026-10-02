import { readFileSync } from 'node:fs';

const [logPath, suiteName] = process.argv.slice(2);
if (!logPath || !suiteName) {
  throw new Error('Usage: node require-jest-summary.mjs <log-path> <suite-name>');
}

const log = readFileSync(logPath, 'utf8').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
const testSummaries = [...log.matchAll(/^Tests:\s*([^\r\n]+)$/gm)].map((match) => match[1]);
const suiteSummaries = [...log.matchAll(/^Test Suites:\s*([^\r\n]+)$/gm)].map((match) => match[1]);

function count(summary, label) {
  const match = summary.match(new RegExp(`(\\d+) ${label}\\b`, 'i'));
  return match ? Number(match[1]) : 0;
}

function total(summary) {
  const match = summary.match(/(\d+) total\b/i);
  return match ? Number(match[1]) : 0;
}

if (testSummaries.length === 0 || suiteSummaries.length === 0 || testSummaries.length !== suiteSummaries.length) {
  throw new Error(`${suiteName}: Jest did not produce a matching test and suite summary for every run`);
}

let totalTests = 0;
let totalSuites = 0;
let passedTests = 0;
for (const [index, testSummary] of testSummaries.entries()) {
  const suiteSummary = suiteSummaries[index];
  const testTotal = total(testSummary);
  const suiteTotal = total(suiteSummary);
  const passed = count(testSummary, 'passed');
  const failed = count(testSummary, 'failed');
  const pending = count(testSummary, 'pending');
  const skipped = count(testSummary, 'skipped');
  const todo = count(testSummary, 'todo');
  const failedSuites = count(suiteSummary, 'failed');
  const pendingSuites = count(suiteSummary, 'pending');
  const skippedSuites = count(suiteSummary, 'skipped');

  if (testTotal < 1 || suiteTotal < 1) {
    throw new Error(`${suiteName}: Jest run ${index + 1} discovered zero tests or suites`);
  }
  if (passed !== testTotal || failed !== 0 || pending !== 0 || skipped !== 0 || todo !== 0 || failedSuites !== 0 || pendingSuites !== 0 || skippedSuites !== 0) {
    throw new Error(`${suiteName}: Jest run ${index + 1} includes a failure, skip, pending test, or todo`);
  }
  totalTests += testTotal;
  totalSuites += suiteTotal;
  passedTests += passed;
}

console.log(`${suiteName}: ${passedTests}/${totalTests} tests passed across ${totalSuites} suites in ${testSummaries.length} Jest runs; no skipped or pending tests`);
