import { appendFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [logPath, suiteName, githubOutputPath] = process.argv.slice(2);
if (!logPath || !suiteName) {
  throw new Error(
    'Usage: node require-jest-summary.mjs <log-path> <suite-name> [github-output-path]',
  );
}

const log = readFileSync(logPath, 'utf8').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
const e2eSuites = ['e2e', 'e2e-release', 'e2e-openai-provider', 'e2e-transcription'];
if (suiteName.startsWith('e2e') && !e2eSuites.includes(suiteName)) {
  throw new Error(`Unknown E2E summary profile: ${suiteName}`);
}
if (githubOutputPath && suiteName === 'e2e') {
  throw new Error('e2e: GitHub outputs require a single E2E profile summary');
}
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

if (
  testSummaries.length === 0 ||
  suiteSummaries.length === 0 ||
  testSummaries.length !== suiteSummaries.length
) {
  throw new Error(
    `${suiteName}: Jest did not produce a matching test and suite summary for every run`,
  );
}
let expectedE2ESuites;
if (e2eSuites.includes(suiteName)) {
  const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
  const requireFromRepository = createRequire(join(repositoryRoot, 'package.json'));
  const releaseConfig = requireFromRepository('./apps/mobile/e2e/release-e2e.jest.config.js');
  const debugConfig = requireFromRepository('./apps/mobile/e2e/openai-provider.jest.config.js');
  const transcriptionConfig = requireFromRepository(
    './apps/mobile/e2e/transcription.jest.config.js',
  );
  const releaseSuiteFiles = requireFromRepository('./apps/mobile/e2e/release-e2e-suite-files.js');
  const expectedReleaseSuiteFiles = [
    './smoke.test.js',
    './appointments.test.js',
    './agentMemory.test.js',
    './graph.test.js',
    './checkpoint.detox.e2e.js',
    './storage.test.js',
  ];
  if (JSON.stringify(releaseSuiteFiles) !== JSON.stringify(expectedReleaseSuiteFiles)) {
    throw new Error(
      'e2e: Release suite manifest does not include the complete required test inventory',
    );
  }
  if (
    JSON.stringify(releaseConfig.testMatch) !==
    JSON.stringify(['<rootDir>/e2e/release-e2e.test.js'])
  ) {
    throw new Error('e2e: Release Jest config must select the explicit suite-inventory wrapper');
  }
  if (
    JSON.stringify(debugConfig.testMatch) !==
    JSON.stringify(['<rootDir>/e2e/openai-provider.e2e.js'])
  ) {
    throw new Error('e2e: OpenAI Debug Jest config must select its dedicated probe');
  }
  const profiles = [
    ['Release', releaseConfig.testMatch, 8],
    ['OpenAI Debug', debugConfig.testMatch, 1],
    ['Speech Transcription', transcriptionConfig.testMatch, 1],
  ].map(([configuration, testMatch, tests]) => {
    if (!Array.isArray(testMatch) || testMatch.length === 0) {
      throw new Error(`e2e: ${configuration} Jest config must enumerate its suites explicitly`);
    }
    return { configuration, suites: testMatch.length, tests };
  });
  const expectedProfile = {
    'e2e-release': profiles[0],
    'e2e-openai-provider': profiles[1],
    'e2e-transcription': profiles[2],
  };
  expectedE2ESuites = suiteName === 'e2e' ? profiles.slice(0, 2) : [expectedProfile[suiteName]];
  if (testSummaries.length !== expectedE2ESuites.length) {
    if (suiteName === 'e2e') {
      throw new Error(
        `e2e: expected one Release and one OpenAI Debug Jest summary, received ${testSummaries.length}`,
      );
    }
    throw new Error(
      `${suiteName}: expected exactly one profile summary, received ${testSummaries.length}`,
    );
  }
} else if (githubOutputPath) {
  throw new Error(`${suiteName}: GitHub outputs are only supported for a single E2E profile`);
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
  const expected = expectedE2ESuites?.[index];
  if (expected && suiteTotal !== expected.suites) {
    throw new Error(
      `e2e: ${expected.configuration} summary expected ${expected.suites} configured suites, received ${suiteTotal}`,
    );
  }
  if (expected && testTotal !== expected.tests) {
    throw new Error(
      `e2e: ${expected.configuration} summary expected ${expected.tests} test cases, received ${testTotal}`,
    );
  }
  if (
    passed !== testTotal ||
    failed !== 0 ||
    pending !== 0 ||
    skipped !== 0 ||
    todo !== 0 ||
    failedSuites !== 0 ||
    pendingSuites !== 0 ||
    skippedSuites !== 0
  ) {
    throw new Error(
      `${suiteName}: Jest run ${index + 1} includes a failure, skip, pending test, or todo`,
    );
  }
  totalTests += testTotal;
  totalSuites += suiteTotal;
  passedTests += passed;
}

console.log(
  `${suiteName}: ${passedTests}/${totalTests} tests passed across ${totalSuites} suites in ${testSummaries.length} Jest runs; no skipped or pending tests`,
);

if (githubOutputPath) {
  const profile = {
    'e2e-release': 'release',
    'e2e-openai-provider': 'openai-provider',
    'e2e-transcription': 'transcription',
  }[suiteName];
  if (!profile) throw new Error(`${suiteName}: no single-profile output mapping exists`);
  appendFileSync(
    githubOutputPath,
    `e2e_profile=${profile}\ne2e_test_cases=${totalTests}\ne2e_test_suites=${totalSuites}\n`,
  );
}
