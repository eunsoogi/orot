import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { IOS_TEST_COHORT_NAMES, iosTestExecutionPlan } from '../ios-test-execution-plan.mjs';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';

const context = { sourceSha: 'a'.repeat(40), runId: '123', attempt: '1' };
const artifact = (cohort) => `ios-cohort-report-${cohort}-${context.runId}-${context.attempt}`;

function reports(t, selectedCohorts = IOS_TEST_COHORT_NAMES) {
  const root = mkdtempSync(join(tmpdir(), 'orot-feature-reports-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const entry of iosTestExecutionPlan(selectedCohorts)) {
    const path = join(root, artifact(entry.cohort));
    mkdirSync(path);
    writeFileSync(
      join(path, 'results.json'),
      JSON.stringify({
        schemaVersion: 2,
        ...context,
        cohort: entry.cohort,
        passed: true,
        tasks: iosTestCohortTasks(entry.cohort).map((task) => ({
          ...task,
          status: 'passed',
          observations: task.identifiers.map((identifier) => ({
            identifier,
            result: 'Passed',
            duration: 1,
          })),
        })),
      }),
    );
  }
  // These synthetic receipts exercise the CLI policy. They make no claim about an Apple service invocation.
  let attachments = null;
  if (selectedCohorts.includes('speech')) {
    attachments = join(root, artifact('speech'), 'speech-integration/attachments');
    mkdirSync(attachments, { recursive: true });
    const fixture = JSON.parse(
      readFileSync('apps/mobile/e2e/transcription/fixtures/synthetic-korean.json', 'utf8'),
    );
    const manifest = [
      {
        attachments: fixture.cases.map((entry) => {
          const name = entry.id + '.json';
          writeFileSync(
            join(attachments, name),
            JSON.stringify({
              id: entry.id,
              expectedText: entry.expectedText,
              inputSha256: entry.audio.sha256,
              syntheticAudio: true,
              serviceResult: true,
              recognizedText: entry.expectedText,
              engine: 'dictation_transcriber',
            }),
          );
          return {
            suggestedHumanReadableName: 'speech-korean-' + entry.id,
            exportedFileName: name,
          };
        }),
      },
    ];
    writeFileSync(join(attachments, 'manifest.json'), JSON.stringify(manifest));
  }
  return { root, attachments };
}

function run(
  root,
  selectedCohorts = IOS_TEST_COHORT_NAMES,
  validationTier = 'full',
  oauthRequired = true,
) {
  return spawnSync(process.execPath, ['scripts/ci/ios-test-plan-results.mjs', root], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_SHA: context.sourceSha,
      GITHUB_RUN_ID: context.runId,
      GITHUB_RUN_ATTEMPT: context.attempt,
      OROT_IOS_TEST_COHORTS: JSON.stringify(selectedCohorts),
      OROT_IOS_VALIDATION_TIER: validationTier,
      OROT_IOS_OAUTH_TESTS: String(oauthRequired),
    },
  });
}

test('the actual aggregation CLI requires every feature report and all Korean fixture attachments', (t) => {
  const { root } = reports(t);
  const outcome = run(root);
  assert.equal(outcome.status, 0, outcome.stderr);
  const result = JSON.parse(readFileSync(join(root, 'complete.json'), 'utf8'));
  assert.equal(result.observations.length, 112);
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.validationTier, 'full');
  assert.equal(result.oauthRequired, true);
  assert.equal(new Set(result.observations.map((entry) => entry.identifier)).size, 112);
  assert.deepEqual(result.selectedCohorts, IOS_TEST_COHORT_NAMES);
  assert.deepEqual(result.executedCohorts, IOS_TEST_COHORT_NAMES);
  assert.deepEqual(result.notSelectedCohorts, []);
  assert.deepEqual(result.notExecutedCohorts, []);
  assert.equal(
    JSON.parse(readFileSync(join(root, 'speech-accuracy.json'), 'utf8')).cases.length,
    3,
  );
});

test('selected aggregation accepts exactly the affected reports and records every skipped cohort', (t) => {
  const selected = ['questions-review', 'questions-conversation', 'questions-summary'];
  const { root } = reports(t, selected);
  const outcome = run(root, selected, 'pr', false);

  assert.equal(outcome.status, 0, outcome.stderr);
  const result = JSON.parse(readFileSync(join(root, 'complete.json'), 'utf8'));
  assert.deepEqual(result.selectedCohorts, selected);
  assert.equal(result.validationTier, 'pr');
  assert.equal(result.oauthRequired, false);
  assert.deepEqual(result.executedCohorts, selected);
  assert.deepEqual(
    result.notSelectedCohorts,
    IOS_TEST_COHORT_NAMES.filter((name) => !selected.includes(name)),
  );
  assert.deepEqual(result.notExecutedCohorts, []);
  assert.equal(
    result.observations.length,
    iosTestCohortTasks('questions').flatMap((task) => task.identifiers).length,
  );
});

test('the Speech evidence verifier runs only when the Speech cohort is selected', (t) => {
  const selected = ['speech'];
  const { root } = reports(t, selected);
  const outcome = run(root, selected, 'pr', false);

  assert.equal(outcome.status, 0, outcome.stderr);
  const result = JSON.parse(readFileSync(join(root, 'complete.json'), 'utf8'));
  assert.deepEqual(result.selectedCohorts, selected);
  assert.equal(result.observations.length, 9);
  assert.equal(
    JSON.parse(readFileSync(join(root, 'speech-accuracy.json'), 'utf8')).cases.length,
    3,
  );
});

test('Full result artifacts require all cohorts and the OAuth suite', (t) => {
  const partial = ['core-ui'];
  const partialReports = reports(t, partial);
  assert.notEqual(run(partialReports.root, partial, 'full', true).status, 0);

  const fullReports = reports(t);
  assert.notEqual(run(fullReports.root, IOS_TEST_COHORT_NAMES, 'full', false).status, 0);
});

test('candidate result artifacts retain their tier and require the complete suite', (t) => {
  const candidateReports = reports(t);
  const candidate = run(candidateReports.root, IOS_TEST_COHORT_NAMES, 'candidate', true);
  assert.equal(candidate.status, 0, candidate.stderr);
  const complete = JSON.parse(readFileSync(join(candidateReports.root, 'complete.json'), 'utf8'));
  assert.equal(complete.validationTier, 'candidate');

  const partialReports = reports(t, ['core-ui']);
  assert.notEqual(run(partialReports.root, ['core-ui'], 'candidate', true).status, 0);
});

for (const failure of [
  'missing-job',
  'unexpected-job',
  'stale-head',
  'repeated-case',
  'failed-case',
  'missing-speech',
])
  test('full aggregation rejects ' + failure, (t) => {
    const { root, attachments } = reports(t);
    const reportPath = join(root, artifact('core-integration'), 'results.json');
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    if (failure === 'missing-job') rmSync(join(root, artifact('health')), { recursive: true });
    if (failure === 'unexpected-job') mkdirSync(join(root, 'old-results'));
    if (failure === 'stale-head') report.sourceSha = 'b'.repeat(40);
    if (failure === 'repeated-case')
      report.tasks[0].observations[1] = report.tasks[0].observations[0];
    if (failure === 'failed-case') report.tasks[0].observations[0].result = 'Failed';
    if (failure === 'missing-speech') rmSync(join(attachments, 'manifest.json'));
    writeFileSync(reportPath, JSON.stringify(report));
    assert.notEqual(run(root).status, 0);
    assert.equal(existsSync(join(root, 'complete.json')), false);
  });
