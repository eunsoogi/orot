import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recoverArchivedReports, recoverLegacyTaskObservations } from '../ios-test-legacy-log.mjs';

const task = { profile: 'core', suite: 'integration', status: 'failed', observations: [] };
const expected = [
  {
    ...task,
    identifiers: ['OrotIntegrationTests/Example/testOne', 'OrotIntegrationTests/Example/testTwo'],
  },
];
const line = (text) => `2026-11-01T22:55:26.6989220Z ${text}`;

test('recovers unique selected terminal results and a source failure from the executor log', () => {
  const log = [
    line(
      '##[group]Run scripts/ci/run-command.sh ios-cohort-tests artifacts/ios-cohort/tests.log -- node scripts/ci/run-ios-test-cohort.mjs',
    ),
    line("Test Case '-[OrotIntegrationTests.Example testOne]' started."),
    line(
      '/Users/runner/work/orot/orot/apps/mobile/ios/OrotIntegrationTests/Example.swift:41: error: -[OrotIntegrationTests.Example testOne] : failed: broken',
    ),
    line("Test Case '-[OrotIntegrationTests.Example testOne]' failed (0.863 seconds)."),
    line("Test Case '-[OrotIntegrationTests.Example testTwo]' started."),
    line("Test Case '-[OrotIntegrationTests.Example testTwo]' passed (0.010 seconds)."),
    line('##[group]Run another step'),
  ].join('\n');
  const [result] = recoverLegacyTaskObservations(log, [task], expected, 'https://example.test/job');
  assert.equal(result.observations.length, 2);
  assert.equal(result.firstFailure.identifier, 'OrotIntegrationTests/Example/testOne');
  assert.equal(result.firstFailure.failure.sourceLocation.lineNumber, 41);
  assert.equal(result.firstFailure.evidence.url, 'https://example.test/job');
});

test('only fetches the unique source attempt job for the exact receipt', async () => {
  const context = {
    sourceSha: 'abc',
    runId: '12',
    attempt: '1',
    repository: 'a/b',
    runUrl: 'https://github.com/a/b/actions/runs/12/attempts/1',
  };
  const report = { cohort: 'core', sourceSha: 'abc', runId: '12', attempt: '1', tasks: [task] };
  const job = {
    id: 9,
    name: 'Test / Core',
    run_id: 12,
    run_attempt: 1,
    head_sha: 'abc',
    conclusion: 'failure',
  };
  const inventory = { plan: () => [{ cohort: 'core', name: 'Core' }], tasks: () => expected };
  const log = [
    line(
      '##[group]Run scripts/ci/run-command.sh ios-cohort-tests artifacts/ios-cohort/tests.log -- node scripts/ci/run-ios-test-cohort.mjs',
    ),
    line("Test Case '-[OrotIntegrationTests.Example testOne]' started."),
    line("Test Case '-[OrotIntegrationTests.Example testOne]' passed (0.1 seconds)."),
    line('##[group]Run another step'),
  ].join('\n');
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: true, text: async () => log };
  };
  const input = {
    reports: [{ report }],
    jobs: [job],
    inventory,
    selectedCohorts: ['core'],
    context,
    token: 'token',
    fetchImpl,
  };
  const [valid] = await recoverArchivedReports(input);
  assert.equal(valid.report.tasks[0].observations.length, 1);
  assert.equal(valid.report.tasks[0].observations[0].evidence.attempt, '1');
  for (const jobs of [[{ ...job, run_attempt: 2 }], [{ ...job, head_sha: 'other' }], [job, job]]) {
    const [invalid] = await recoverArchivedReports({ ...input, jobs });
    assert.equal(invalid.report.tasks[0].observations.length, 0);
  }
  assert.equal(calls, 1);
});

test('does not infer from duplicates, ambiguous selection, or structured observations', () => {
  const terminal = line(
    "Test Case '-[OrotIntegrationTests.Example testOne]' passed (0.010 seconds).",
  );
  const log = [
    line(
      '##[group]Run scripts/ci/run-command.sh ios-cohort-tests artifacts/ios-cohort/tests.log -- node scripts/ci/run-ios-test-cohort.mjs',
    ),
    line("Test Case '-[OrotIntegrationTests.Example testOne]' started."),
    terminal,
    line("Test Case '-[OrotIntegrationTests.Example testOne]' started."),
    terminal,
    line('##[group]Run another step'),
  ].join('\n');
  assert.equal(
    recoverLegacyTaskObservations(log, [task], expected, 'job')[0].observations.length,
    0,
  );
  const unique = log.replace(
    terminal +
      '\n' +
      line("Test Case '-[OrotIntegrationTests.Example testOne]' started.") +
      '\n' +
      terminal,
    terminal,
  );
  assert.equal(
    recoverLegacyTaskObservations(
      unique,
      [task],
      [...expected, { ...expected[0], suite: 'other' }],
      'job',
    )[0].observations.length,
    0,
  );
  const structured = {
    ...task,
    observations: [{ identifier: expected[0].identifiers[0], result: 'Failed' }],
  };
  assert.deepEqual(
    recoverLegacyTaskObservations(log, [structured], expected, 'job')[0],
    structured,
  );
});

test('rejects a terminal without a start and a truncated executor step', () => {
  const start = line(
    '##[group]Run scripts/ci/run-command.sh ios-cohort-tests artifacts/ios-cohort/tests.log -- node scripts/ci/run-ios-test-cohort.mjs',
  );
  const terminal = line(
    "Test Case '-[OrotIntegrationTests.Example testOne]' failed (0.1 seconds).",
  );
  const end = line('##[group]Run another step');
  for (const log of [
    [start, terminal, end],
    [start, line("Test Case '-[OrotIntegrationTests.Example testOne]' started."), terminal],
  ]) {
    assert.equal(
      recoverLegacyTaskObservations(log.join('\n'), [task], expected, 'job')[0].observations.length,
      0,
    );
  }
});

test('keeps a proven first failure when a later test has ambiguous retries', () => {
  const start = line(
    '##[group]Run scripts/ci/run-command.sh ios-cohort-tests artifacts/ios-cohort/tests.log -- node scripts/ci/run-ios-test-cohort.mjs',
  );
  const record = (name, result) => [
    line(`Test Case '-[OrotIntegrationTests.Example ${name}]' started.`),
    line(`Test Case '-[OrotIntegrationTests.Example ${name}]' ${result} (0.1 seconds).`),
  ];
  const log = [
    start,
    ...record('testOne', 'failed'),
    ...record('testTwo', 'failed'),
    ...record('testTwo', 'passed'),
    line('##[group]Run another step'),
  ].join('\n');
  const [result] = recoverLegacyTaskObservations(log, [task], expected, 'job');
  assert.equal(result.firstFailure.identifier, 'OrotIntegrationTests/Example/testOne');
  assert.deepEqual(
    result.observations.map((item) => item.identifier),
    ['OrotIntegrationTests/Example/testOne'],
  );
});
