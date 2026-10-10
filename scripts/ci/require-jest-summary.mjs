import { appendFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readReleaseShardBlocks,
  resolveSelectedReleaseShard,
  validateReleaseJestConfig,
} from './release-jest-summary.mjs';

const [logPath, suiteName, githubOutputPath] = process.argv.slice(2);
if (!logPath || !suiteName) {
  throw new Error(
    'Usage: node require-jest-summary.mjs <log-path> <suite-name> [github-output-path]',
  );
}

const log = readFileSync(logPath, 'utf8').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
const e2eSuites = [
  'e2e',
  'e2e-release',
  'e2e-openai-provider',
  'e2e-transcription',
  'e2e-next-visit-questions',
];
if (suiteName.startsWith('e2e') && !e2eSuites.includes(suiteName)) {
  throw new Error(`Unknown E2E summary profile: ${suiteName}`);
}
if (githubOutputPath && suiteName === 'e2e') {
  throw new Error('e2e: GitHub outputs require a single E2E profile summary');
}
const testSummaryMatches = [...log.matchAll(/^Tests:\s*([^\r\n]+)$/gm)];
const suiteSummaryMatches = [...log.matchAll(/^Test Suites:\s*([^\r\n]+)$/gm)];
const testSummaries = testSummaryMatches.map((match) => match[1]);
const suiteSummaries = suiteSummaryMatches.map((match) => match[1]);

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

const releaseShardBlocks = readReleaseShardBlocks(log);
const releaseShardingRequired = process.env.OROT_DETOX_RELEASE_SHARDING === 'true';
const selectedReleaseShardExpectation = resolveSelectedReleaseShard({
  suiteName,
  releaseShardBlocks,
  releaseShardingRequired,
});
if (releaseShardingRequired && !releaseShardBlocks) {
  throw new Error('e2e-release: required Release shard summary markers are missing');
}
if (releaseShardBlocks && !['e2e', 'e2e-release'].includes(suiteName)) {
  throw new Error(`${suiteName}: Release shard summaries appeared in another profile`);
}
if (releaseShardingRequired && !['e2e', 'e2e-release'].includes(suiteName)) {
  throw new Error(`${suiteName}: Release sharding is not valid for this E2E profile`);
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
  const nextVisitQuestionsConfig = requireFromRepository(
    './apps/mobile/e2e/next-visit-questions.jest.config.js',
  );
  const releaseSuiteFiles = requireFromRepository('./apps/mobile/e2e/release-e2e-suite-files.js');
  const releaseE2EShards = requireFromRepository('./apps/mobile/e2e/release-e2e-shards.js');
  validateReleaseJestConfig({
    releaseSuiteFiles,
    releaseE2EShards,
    releaseConfig,
    selectedReleaseShard: selectedReleaseShardExpectation,
  });
  if (
    JSON.stringify(debugConfig.testMatch) !==
    JSON.stringify(['<rootDir>/e2e/openai-provider.e2e.js'])
  ) {
    throw new Error('e2e: OpenAI Debug Jest config must select its dedicated probe');
  }
  if (
    JSON.stringify(nextVisitQuestionsConfig.testMatch) !==
    JSON.stringify(['<rootDir>/e2e/next-visit-questions.e2e.js'])
  ) {
    throw new Error('e2e: Next Visit Questions Jest config must select its dedicated probe');
  }
  const profiles = [
    ['Release', releaseConfig.testMatch, 21],
    ['OpenAI Debug', debugConfig.testMatch, 1],
    ['Speech Transcription', transcriptionConfig.testMatch, 1],
    ['Next Visit Questions', nextVisitQuestionsConfig.testMatch, 1],
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
    'e2e-next-visit-questions': profiles[3],
  };
  if (releaseShardBlocks) {
    const blockRanges = releaseShardBlocks.map(({ start, end }) => ({ start, end }));
    const unmarkedTests = testSummaryMatches.filter(
      (match) => !blockRanges.some(({ start, end }) => match.index >= start && match.index < end),
    );
    const unmarkedSuites = suiteSummaryMatches.filter(
      (match) => !blockRanges.some(({ start, end }) => match.index >= start && match.index < end),
    );
    const expectedUnmarkedSummaries = suiteName === 'e2e' ? 1 : 0;
    if (
      unmarkedTests.length !== expectedUnmarkedSummaries ||
      unmarkedSuites.length !== expectedUnmarkedSummaries ||
      (suiteName === 'e2e' &&
        (unmarkedTests[0]?.index <= releaseShardBlocks.at(-1).end ||
          unmarkedSuites[0]?.index <= releaseShardBlocks.at(-1).end))
    ) {
      throw new Error(`${suiteName}: expected one OpenAI Debug summary after all Release shards`);
    }
    expectedE2ESuites = [
      ...releaseShardBlocks.map(({ expected }) => expected),
      ...(suiteName === 'e2e' ? [profiles[1]] : []),
    ];
    if (testSummaries.length !== expectedE2ESuites.length) {
      throw new Error(`${suiteName}: summary count does not match its explicit Release shards`);
    }
  } else {
    expectedE2ESuites = selectedReleaseShardExpectation
      ? [selectedReleaseShardExpectation]
      : suiteName === 'e2e'
        ? profiles.slice(0, 2)
        : [expectedProfile[suiteName]];
  }
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
    'e2e-next-visit-questions': 'next-visit-questions',
  }[suiteName];
  if (!profile) throw new Error(`${suiteName}: no single-profile output mapping exists`);
  appendFileSync(
    githubOutputPath,
    `e2e_profile=${profile}\ne2e_test_cases=${totalTests}\ne2e_test_suites=${totalSuites}\n`,
  );
}
