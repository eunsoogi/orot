import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { CHECK_KEYS, selectEverything } from '../changed-paths-core.mjs';
import { writeSelectionReport } from '../ios-e2e-selection-report.mjs';

const CLI_PATH = fileURLToPath(new URL('../select-changed-paths.mjs', import.meta.url));

function runManualDispatch(
  outputPath,
  ref = 'refs/heads/main',
  includeSummary = false,
  candidate = null,
) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-ci-paths-'));
  const eventPath = join(directory, 'event.json');
  const summaryPath = join(directory, 'summary.md');
  writeFileSync(eventPath, '{}');
  try {
    const result = spawnSync(process.execPath, [CLI_PATH], {
      encoding: 'utf8',
      cwd: directory,
      env: {
        ...process.env,
        GITHUB_ACTIONS: 'true',
        GITHUB_EVENT_NAME: 'workflow_dispatch',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_OUTPUT: outputPath,
        GITHUB_REF: ref,
        ...(candidate ? { GITHUB_SHA: candidate.headSha } : {}),
        ...(candidate ? { GITHUB_REPOSITORY: 'eunsoogi/orot' } : {}),
        ...(includeSummary ? { GITHUB_STEP_SUMMARY: summaryPath } : {}),
        ...(candidate
          ? {
              OROT_IOS_CANDIDATE_PR_NUMBER: String(candidate.number),
              OROT_IOS_CANDIDATE_HEAD_REF: candidate.headRef,
              OROT_IOS_CANDIDATE_HEAD_SHA: candidate.headSha,
            }
          : {}),
      },
    });
    const reportPath = join(directory, 'artifacts/ios-e2e-selection.json');
    return {
      result,
      report: existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null,
      summary: existsSync(summaryPath) ? readFileSync(summaryPath, 'utf8') : null,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('CLI labels an unconfigured manual event as diagnostic without scheduling protected E2E', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-ci-paths-output-'));
  const outputPath = join(directory, 'output');
  try {
    // Direct CLI use cannot enable manual E2E because the public workflow has no manual trigger.
    const { result, report, summary } = runManualDispatch(outputPath, 'refs/heads/main', true);
    assert.equal(result.status, 0, result.stderr);
    const outputs = Object.fromEntries(
      readFileSync(outputPath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => line.split('=')),
    );
    assert.equal(outputs.all, 'true');
    assert.equal(outputs.reason, 'manual-full-inventory-selection');
    assert.equal(outputs.validation_tier, 'diagnostic');
    assert.equal(outputs.selection_complete, 'true');
    assert.equal(
      CHECK_KEYS.every((key) => outputs[key] === 'true'),
      true,
    );
    assert.equal(report.schemaVersion, 2);
    assert.equal(report.validationTier, 'diagnostic');
    assert.match(summary, /diagnostic selection only; protected iOS validation is not scheduled/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('CLI fails the owning check when GitHub Actions omits its output file', () => {
  const { result } = runManualDispatch('');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /required checks must fail safe/);
});

test('off-main manual dispatch is described as diagnostic without protected iOS execution', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-ci-paths-output-'));
  const outputPath = join(directory, 'output');
  try {
    const { result, report, summary } = runManualDispatch(outputPath, 'refs/heads/feature', true);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(report.validationTier, 'diagnostic');
    assert.match(summary, /diagnostic selection only; protected iOS validation is not scheduled/);
    assert.doesNotMatch(summary, /scheduled for automatic execution/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('PR impact selection is reported without implying E2E execution', () => {
  const previousCwd = process.cwd();
  const directory = mkdtempSync(join(tmpdir(), 'orot-ci-pr-selection-'));
  const summaryPath = join(directory, 'summary.md');
  const originalEnvironment = new Map(
    ['GITHUB_ACTIONS', 'GITHUB_STEP_SUMMARY'].map((key) => [key, process.env[key]]),
  );
  try {
    process.chdir(directory);
    process.env.GITHUB_ACTIONS = 'true';
    process.env.GITHUB_STEP_SUMMARY = summaryPath;
    const selection = selectEverything('report-test');
    selection.validation_tier = 'pr';

    writeSelectionReport(selection, 'pull_request', null, false);

    const summary = readFileSync(summaryPath, 'utf8');
    assert.match(
      summary,
      /PR impact selection is report-only; Full E2E runs on the nightly main schedule/,
    );
    assert.doesNotMatch(summary, /scheduled for automatic execution/);
  } finally {
    process.chdir(previousCwd);
    for (const [key, value] of originalEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a verified candidate dispatch records its exact PR head and full selection', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-ci-paths-output-'));
  const outputPath = join(directory, 'output');
  const candidate = {
    number: 217,
    headRef: 'eunsoogi/issue-216-validation-policy',
    headSha: 'a'.repeat(40),
  };
  try {
    const { result, report, summary } = runManualDispatch(
      outputPath,
      'refs/heads/' + candidate.headRef,
      true,
      candidate,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(report.validationTier, 'candidate');
    assert.deepEqual(report.candidatePullRequest, {
      repository: 'eunsoogi/orot',
      number: candidate.number,
      headRef: candidate.headRef,
      headSha: candidate.headSha,
    });
    assert.equal(report.sourceSha, candidate.headSha);
    assert.equal(report.selectedCohorts.length, 24);
    assert.equal(report.oauthSelected, true);
    assert.match(summary, /full candidate validation for the verified Draft PR head/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
