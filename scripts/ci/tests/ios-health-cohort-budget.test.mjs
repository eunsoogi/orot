import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iosTestExecutionPlan } from '../ios-test-execution-plan.mjs';
import {
  iosTestCohort,
  iosTestCohortTasks,
  verifyIosSimulatorOwnerContract,
} from '../ios-test-cohorts.mjs';
import { iosTestInventory } from '../ios-test-inventory.mjs';
import { iosTestImpactForPath } from '../ios-test-impact.mjs';
import { verifyIosTestCohortResults } from '../ios-test-cohort-results.mjs';
import { cohortJobs, workflow } from './fixtures/ios-workflow.mjs';

const cohorts = ['health-observations', 'health-recovery'];
// Independent original inventory prevents a dropped registration from satisfying exact-once coverage.
const original = [
  'OrotUITests/HealthImportUITests/testSyntheticBloodPressurePersistsAndReplaysAfterProcessRestart',
  'OrotUITests/HealthImportUITests/testCommonObservationsUseEncryptedStorageAndIdempotentReplay',
  'OrotUITests/UnifiedImportUITests/testSyntheticConsentMeasurementsAndExplicitCalendarConfirmation',
  'OrotUITests/UnifiedImportUITests/testCancellationPreventsQueriesAndPersistenceBeforeSameSelectionRetry',
];
const documentJourneys = [
  'OrotUITests/MedicalDocumentImportJourneyUITests/testTextBasedPdfCanBeReviewedSavedAndOpenedWithProvenance',
  'OrotUITests/MedicalDocumentImportJourneyUITests/testDuplicateImportKeepsSavedOriginalAndProvenance',
  'OrotUITests/MedicalDocumentImportJourneyUITests/testScannedPdfIsRejectedWithoutSavingSource',
];
const context = { sourceSha: 'a'.repeat(40), runId: '123', attempt: '1' };

function report(cohort) {
  return {
    schemaVersion: 2,
    ...context,
    cohort,
    passed: true,
    tasks: iosTestCohortTasks(cohort).map((task) => ({
      ...task,
      status: 'passed',
      observations: task.identifiers.map((identifier) => ({ identifier, result: 'Passed' })),
    })),
  };
}

test('Health cohorts retain their four cases while both import profiles cover documents', () => {
  // The three picker journeys belong to both broad profiles; focused Health cohorts remain Health-only.
  assert.deepEqual(iosTestInventory('health-import'), [...original, ...documentJourneys]);
  assert.deepEqual(
    iosTestInventory('fixtures', 'calendar').filter((identifier) =>
      documentJourneys.includes(identifier),
    ),
    documentJourneys,
  );
  // Keep the observed long storage journeys in different budgets without cutting either method.
  assert.deepEqual(iosTestCohortTasks(cohorts[0])[0].identifiers, [original[1], original[2]]);
  assert.deepEqual(iosTestCohortTasks(cohorts[1])[0].identifiers, [original[0], original[3]]);
  const full = iosTestExecutionPlan();
  assert.deepEqual(
    full.filter(({ cohort }) => cohorts.includes(cohort)).map(({ cohort }) => cohort),
    cohorts,
  );
  for (const selection of [
    cohorts,
    ...[
      'apps/mobile/src/healthkit/import.ts',
      'apps/mobile/e2e/health-import.e2e.js',
      'apps/mobile/ios/OrotUITests/HealthImportUITests.swift',
      'apps/mobile/ios/OrotUITests/UnifiedImportUITests.swift',
      'apps/mobile/ios/OrotMobile/HealthKitAuthorization.swift',
      'packages/storage/src/index.ts',
    ].map((path) => iosTestImpactForPath(path).cohorts),
  ]) {
    const plan = iosTestExecutionPlan(selection).filter(({ cohort }) => cohorts.includes(cohort));
    assert.deepEqual(
      plan,
      full.filter(({ cohort }) => cohorts.includes(cohort)),
    );
    const actual = plan.flatMap(({ cohort, minutes }) => {
      assert.equal(minutes, 20);
      const [task] = iosTestCohortTasks(cohort);
      assert.equal(task.profile, 'health-import');
      assert.equal(task.suite, 'all');
      assert.equal(task.mode, 'fixture');
      assert.equal(task.identifiers.length, 2);
      return task.identifiers;
    });
    assert.deepEqual(actual.slice().sort(), original.slice().sort());
    assert.equal(new Set(actual).size, original.length);
  }
});

test('each Health leaf has its own capped job, diagnostics and Simulator ownership', () => {
  const jobs = cohortJobs(workflow('.github/workflows/e2e-test.yml').jobs);
  for (const cohort of cohorts) {
    const matches = jobs.filter(([, { inputs }]) => inputs.cohort === cohort);
    assert.equal(matches.length, 1);
    const { leaf, inputs } = matches[0][1];
    assert.equal(leaf.needs, undefined);
    assert.equal(leaf.strategy, undefined);
    assert.equal(leaf['timeout-minutes'], 20);
    assert.equal(leaf.if, "${{ contains(fromJSON(inputs.cohorts), '" + cohort + "') }}");
    assert.equal(inputs.profile, 'health-import');
    assert.ok(leaf.steps.some((step) => step.with?.cohort === cohort && step.if === 'always()'));
    const { config } = iosTestCohort(cohort);
    const owner = {
      cohort,
      profiles: ['health-import'],
      name: `OrotTests-cohort-${cohort}-123-1`,
      runtime: config.runtime,
      device: config.device,
    };
    assert.doesNotThrow(() => verifyIosSimulatorOwnerContract(owner, 'health-import'));
    // Equal profiles never authorize one leaf to take over a sibling's Simulator.
    assert.throws(
      () =>
        verifyIosSimulatorOwnerContract(
          { ...owner, cohort: cohorts.find((name) => name !== cohort) },
          'health-import',
        ),
      /ownership mismatch/,
    );
  }
});

for (const cohort of cohorts) {
  test(`${cohort} accepts only its complete independent first-execution result`, () => {
    assert.equal(verifyIosTestCohortResults(report(cohort), cohort, context).length, 2);
    const cleanupFailure = report(cohort);
    cleanupFailure.passed = false;
    assert.throws(() => verifyIosTestCohortResults(cleanupFailure, cohort, context));
    assert.throws(() =>
      verifyIosTestCohortResults(report(cohorts.find((name) => name !== cohort)), cohort, context),
    );
    for (const status of ['failed', 'cancelled', 'skipped', undefined]) {
      const current = report(cohort);
      current.tasks[0].status = status;
      assert.throws(() => verifyIosTestCohortResults(current, cohort, context));
    }
    for (const result of ['Failed', 'Cancelled', 'Skipped', undefined]) {
      const current = report(cohort);
      current.tasks[0].observations[0].result = result;
      assert.throws(() => verifyIosTestCohortResults(current, cohort, context));
    }
    const incomplete = report(cohort);
    incomplete.tasks[0].observations.pop();
    assert.throws(() => verifyIosTestCohortResults(incomplete, cohort, context));
  });
}

// Exercise the real aggregation entry point with synthetic reports, not an assertion of hosted success.
for (const failure of [undefined, 'missing', 'swapped', 'cancelled', 'failed', 'duplicate'])
  test(`Health selected aggregation ${failure ? 'rejects ' + failure : 'retains both leaf reports'}`, (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-health-reports-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    for (const cohort of cohorts) {
      const current = report(cohort);
      if (cohort === cohorts[1]) {
        if (failure === 'missing') continue;
        if (failure === 'swapped') current.cohort = cohorts[0];
        if (failure === 'cancelled') current.tasks[0].status = 'cancelled';
        if (failure === 'failed') current.tasks[0].observations[0].result = 'Failed';
        if (failure === 'duplicate')
          current.tasks[0].observations[1] = current.tasks[0].observations[0];
      }
      const path = join(
        directory,
        `ios-cohort-report-${cohort}-${context.runId}-${context.attempt}`,
      );
      mkdirSync(path);
      writeFileSync(join(path, 'results.json'), JSON.stringify(current));
    }
    const result = spawnSync(
      process.execPath,
      ['scripts/ci/ios-test-plan-results.mjs', directory],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_SHA: context.sourceSha,
          GITHUB_RUN_ID: context.runId,
          GITHUB_RUN_ATTEMPT: context.attempt,
          OROT_IOS_TEST_COHORTS: JSON.stringify(cohorts),
          OROT_IOS_VALIDATION_TIER: 'pr',
          OROT_IOS_OAUTH_TESTS: 'false',
          OROT_IOS_AUTHENTICATION_EVIDENCE: '',
        },
      },
    );
    const output = join(directory, 'complete.json');
    if (failure) {
      assert.notEqual(result.status, 0);
      assert.equal(existsSync(output), false);
    } else {
      assert.equal(result.status, 0, result.stderr);
      const complete = JSON.parse(readFileSync(output, 'utf8'));
      assert.deepEqual(complete.selectedCohorts, cohorts);
      assert.deepEqual(complete.executedCohorts, cohorts);
      assert.deepEqual(complete.notExecutedCohorts, []);
      assert.deepEqual(
        complete.observations.map(({ identifier }) => identifier).sort(),
        original.slice().sort(),
      );
    }
  });
