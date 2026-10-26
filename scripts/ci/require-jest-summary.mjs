import { readFileSync } from 'node:fs';

const [logPath, suiteName, extra] = process.argv.slice(2);
if (!logPath || suiteName !== 'unit' || extra)
  throw new Error('Usage: require-jest-summary.mjs <log-path> unit');

// Every workspace Jest invocation must discover and pass tests. iOS validation reads xcresult instead of accepting a textual Jest substitute.
const log = readFileSync(logPath, 'utf8').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
const tests = [...log.matchAll(/^Tests:\s*([^\r\n]+)$/gm)].map((match) => match[1]);
const suites = [...log.matchAll(/^Test Suites:\s*([^\r\n]+)$/gm)].map((match) => match[1]);
if (!tests.length || tests.length !== suites.length)
  throw new Error('unit: Jest did not produce a matching test and suite summary for every run');

function count(summary, label) {
  return Number(summary.match(new RegExp(`(\\d+) ${label}\\b`, 'i'))?.[1] ?? 0);
}

let totalTests = 0;
let totalSuites = 0;
for (const [index, summary] of tests.entries()) {
  const testTotal = count(summary, 'total');
  const suiteTotal = count(suites[index], 'total');
  if (!testTotal || !suiteTotal)
    throw new Error(`unit: Jest run ${index + 1} discovered zero tests or suites`);
  for (const value of [summary, suites[index]]) {
    if (
      count(value, 'passed') !== count(value, 'total') ||
      ['failed', 'skipped', 'pending', 'todo'].some((state) => count(value, state) !== 0)
    )
      throw new Error(
        `unit: Jest run ${index + 1} includes a failure, skip, pending test, or todo`,
      );
  }
  totalTests += testTotal;
  totalSuites += suiteTotal;
}
console.log(
  `unit: ${totalTests}/${totalTests} tests passed across ${totalSuites} suites in ${tests.length} Jest runs; no skipped or pending tests`,
);
