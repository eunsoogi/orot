import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { focusedIosTestCohorts, selectFocusedIosTests } from '../ios-focused-selection.mjs';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';
import { iosTestInventory } from '../ios-test-inventory.mjs';

const sha = 'a'.repeat(40);
const context = { GITHUB_SHA: sha, GITHUB_RUN_ID: '1234', GITHUB_RUN_ATTEMPT: '1' };
const inputs = ['core', 'backup', 'local-model'].map((profile) => {
  const identifier = iosTestInventory(profile, profile === 'core' ? 'integration' : 'all')[0];
  const [target, name] = identifier.split('/');
  return [
    'ios/' + profile,
    `apps/mobile/ios/${target}/${name}.swift`,
    profile === 'core' ? identifier : 'all',
  ];
});
inputs.push(['ios/fixtures', 'scripts/ci/ios-test-fixture-groups.mjs', 'group/recordings']);
for (const group of ['navigation', 'calendar', 'questions', 'all'])
  inputs.push([
    'ios/fixtures',
    'scripts/ci/ios-test-fixture-groups.mjs',
    group === 'all' ? 'all' : `group/${group}`,
  ]);
inputs.push(['ios/speech', 'scripts/ci/speech-journey-test-phases.mjs', 'group/journey']);
inputs.push(['ios/core', 'scripts/ci/fixture-isolation-test-phases.mjs', 'group/isolation']);
inputs.push([
  'ios/core',
  'scripts/ci/recording-persistence-test-phases.mjs',
  'group/recording-persistence',
]);
inputs.push(
  [
    'ios/provider-data',
    'apps/mobile/ios/OrotIntegrationTests/AppleModelIntegrationTests.swift',
    'OrotIntegrationTests/AppleModelIntegrationTests/testMockAvailabilityGenerationStreamingCancellationAndFailures',
  ],
  [
    'ios/fixtures',
    'apps/mobile/ios/OrotUITests/RootNavigationUITests.swift',
    'OrotUITests/RootNavigationUITests/testAiFeatureSafeAreaActionsAndCancelledThenCompletedEdgeBack',
  ],
);

// These fixtures prove Linux aggregation only, never integration runtime behavior.
function fixture(input, mutate = () => {}, environment = context, mutateFiles = () => {}) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-ios-focus-results-'));
  try {
    const selection = selectFocusedIosTests(...input);
    const manifest = {
      context: {
        sourceSha: sha,
        runId: '1234',
        attempt: '1',
        spec: {
          configuration: selection.configuration,
          compatibleExecutions: [selection.profile],
        },
      },
    };
    const report = {
      observations: selection.identifiers.map((identifier) => ({
        identifier,
        result: 'Passed',
        duration: 1,
      })),
    };
    mutate(manifest, report);
    mkdirSync(join(directory, 'product-artifact'));
    writeFileSync(join(directory, 'product-artifact/manifest.json'), JSON.stringify(manifest));
    const path =
      selection.mode === 'fixture'
        ? 'fixtures/results.json'
        : [
              'backup',
              'local-model',
              'speech-journey',
              'fixture-isolation',
              'recording-persistence',
              'state-persistence',
            ].includes(selection.mode)
          ? selection.mode + '/results.json'
          : 'results.json';
    if (path.includes('/')) mkdirSync(join(directory, path.split('/')[0]));
    writeFileSync(join(directory, path), JSON.stringify(report));
    for (const cohort of focusedIosTestCohorts(selection)) {
      const destination = join(directory, 'cohorts', `ios-cohort-report-${cohort}-1234-1`);
      mkdirSync(destination, { recursive: true });
      writeFileSync(
        join(destination, 'results.json'),
        JSON.stringify({
          schemaVersion: 2,
          cohort,
          passed: true,
          sourceSha: sha,
          runId: '1234',
          attempt: '1',
          tasks: iosTestCohortTasks(cohort).map((task) => ({
            profile: task.profile,
            suite: task.suite,
            status: 'passed',
            observations: report.observations.filter((observation) =>
              task.identifiers.includes(observation.identifier),
            ),
          })),
        }),
      );
    }
    mutateFiles(directory);
    return spawnSync(
      process.execPath,
      ['scripts/ci/ios-focused-results.mjs', ...input, directory],
      {
        encoding: 'utf8',
        env: { ...process.env, ...environment },
      },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('Linux focus aggregation reads every evidence layout and always marks selection partial', () => {
  for (const input of inputs) {
    const result = fixture(input);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.fullValidation, false);
    assert.equal(report.sourceSha, sha);
    assert.equal(report.selectedCases, selectFocusedIosTests(...input).expectedCount);
  }
});

test('partitioned focus rejects a missing partition or an unexpected cohort artifact', () => {
  const input = ['ios/fixtures', 'scripts/ci/ios-test-fixture-groups.mjs', 'group/navigation'];
  for (const unexpected of [false, true]) {
    const result = fixture(input, undefined, context, (directory) => {
      const reports = join(directory, 'cohorts');
      if (unexpected) mkdirSync(join(reports, 'unexpected-cohort'));
      else rmSync(join(reports, 'ios-cohort-report-navigation-routes-1234-1'), { recursive: true });
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /omit a selected partition|unexpected report/);
  }
});

test('focus aggregation rejects stale context, incompatible products and incomplete first attempts', () => {
  for (const mutate of [
    (manifest) => {
      manifest.context.sourceSha = 'b'.repeat(40);
    },
    (manifest) => {
      manifest.context.runId = '1235';
    },
    (manifest) => {
      manifest.context.attempt = '2';
    },
    (manifest) => {
      manifest.context.spec.configuration = 'Debug';
    },
    (manifest) => {
      manifest.context.spec.compatibleExecutions = [];
    },
    (_manifest, report) => {
      report.observations.pop();
    },
    (_manifest, report) => {
      report.observations[0].result = 'Skipped';
    },
    (_manifest, report) => {
      report.observations[0].result = 'Failed';
    },
    (_manifest, report) => {
      report.observations.push(report.observations[0]);
    },
  ])
    assert.notEqual(fixture(inputs[3], mutate).status, 0);
  assert.notEqual(fixture(inputs[3], undefined, { ...context, GITHUB_SHA: '' }).status, 0);
});
