import assert from 'node:assert/strict';
import test from 'node:test';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';
import { IOS_TEST_COHORT_NAMES, iosTestExecutionPlan } from '../ios-test-execution-plan.mjs';
import { iosTestInventory } from '../ios-test-inventory.mjs';
import { buildIosTestRunSummary } from '../ios-test-run-summary.mjs';
import { renderIosTestRunSummaryMarkdown } from '../ios-test-run-summary-markdown.mjs';

const context = {
  sourceSha: 'a'.repeat(40),
  runId: '12345',
  attempt: '2',
  repository: 'eunsoogi/orot',
  serverUrl: 'https://github.com',
  runUrl: 'https://github.com/eunsoogi/orot/actions/runs/12345/attempts/2',
};
const selectedCohorts = ['core-integration'];

function reportFor(cohort, changes = {}) {
  const tasks = iosTestCohortTasks(cohort).map((task, index) => {
    const observations = task.identifiers.map((identifier, position) => ({
      identifier,
      result: index === 0 && position === 0 ? 'Failed' : 'Passed',
      duration: position + 1,
      ...(index === 0 && position === 0
        ? {
            failure: {
              message: 'XCTAssertEqual failed',
              sourceLocation: {
                filePath: 'apps/mobile/ios/OrotIntegrationTests/CoreStateTests.swift',
                lineNumber: 42,
              },
            },
          }
        : {}),
    }));
    return {
      profile: task.profile,
      suite: task.suite,
      status: index === 0 ? 'failed' : 'not-run',
      error: index === 0 ? 'Xcode exited 65' : undefined,
      observations: index === 0 ? observations : [],
      ...(index === 0 ? { firstFailure: observations[0] } : {}),
      ...(index === 0 ? { elapsedMs: 5000 } : {}),
    };
  });
  return {
    artifactName: `ios-cohort-report-${cohort}`,
    report: {
      schemaVersion: 2,
      ...context,
      cohort,
      passed: false,
      firstFailureElapsedMs: 3200,
      uiPreparationElapsedMs: 1000,
      uiBootstrapElapsedMs: 700,
      tasks,
      ...changes,
    },
  };
}

function summarize(reports, changes = {}) {
  return buildIosTestRunSummary({
    selectedCohorts,
    reports,
    executionResults: {
      production_validation: { result: 'success' },
      oauth_products: { result: 'success' },
      oauth_execution: { result: 'failure' },
    },
    oauthRequired: true,
    validationTier: 'pr',
    context,
    root: process.cwd(),
    ...changes,
  });
}

test('joins exact-attempt failures and keeps opt-in and production coverage separate', () => {
  const report = reportFor('core-integration');
  const summary = summarize([report], { validationTier: 'full' });
  const failed = summary.cases.find((item) => item.status === 'failed');
  const markdown = renderIosTestRunSummaryMarkdown(summary);

  assert.equal(summary.coverage.ordinaryIphone.counts.failed, 1);
  assert.equal(summary.coverage.duo.selected, false);
  assert.equal(summary.coverage.duo.expectedCount, iosTestInventory('duo').length);
  assert.equal(summary.coverage.authentication.selected, true);
  assert.equal(summary.coverage.authentication.jobStatus, 'unexecuted');
  assert.equal(summary.coverage.oauth.status, 'failed');
  assert.equal(summary.coverage.production.status, 'passed');
  assert.equal(summary.firstFailures.length, 1);
  assert.equal(summary.firstFailures[0].elapsedMs, 3200);
  assert.equal(failed.failure.message, 'XCTAssertEqual failed');
  assert.equal(
    failed.sourceUrl,
    `https://github.com/eunsoogi/orot/blob/${context.sourceSha}/apps/mobile/ios/OrotIntegrationTests/CoreStateTests.swift#L42`,
  );
  assert.equal(failed.runUrl, context.runUrl);
  assert.match(markdown, /Opt-in Duo \| 0\//);
  assert.match(markdown, /First task failures/);
  assert.match(markdown, /CoreStateTests.swift#L42/);
  assert.match(markdown, /actions\/runs\/12345\/attempts\/2/);
});

test('keeps failed, cancelled, skipped and unexecuted case links bound to this attempt', () => {
  const core = reportFor('core-integration');
  core.report.tasks[0].observations[1].result = 'Cancelled';
  core.report.tasks[0].observations[2].result = 'Skipped';
  const speech = reportFor('speech');
  const summary = summarize([core, speech], {
    selectedCohorts: ['core-integration', 'speech'],
    validationTier: 'pr',
    oauthRequired: false,
    executionResults: {},
  });
  const incomplete = summary.cases.filter((item) =>
    ['failed', 'cancelled', 'skipped', 'unexecuted'].includes(item.status),
  );

  for (const status of ['failed', 'cancelled', 'skipped', 'unexecuted'])
    assert.ok(
      incomplete.some((item) => item.status === status),
      `missing ${status} case`,
    );
  for (const item of incomplete) {
    assert.equal(item.runUrl, context.runUrl);
    assert.match(
      item.sourceUrl,
      new RegExp(`^https://github\\.com/eunsoogi/orot/blob/${context.sourceSha}/apps/mobile/ios/`),
    );
  }
});

test('duplicate and stale cohort artifacts remain visible and cannot supply first failures', () => {
  const current = reportFor('core-integration');
  const duplicate = summarize([current, reportFor('core-integration')]);
  assert.equal(
    duplicate.coverage.ordinaryIphone.counts.duplicate,
    iosTestCohortTasks('core-integration').flatMap((task) => task.identifiers).length,
  );
  assert.equal(duplicate.firstFailures.length, 0);
  assert.equal(duplicate.expensiveTasks.length, 0);

  const stale = summarize([reportFor('core-integration', { attempt: '1' })]);
  assert.equal(
    stale.coverage.ordinaryIphone.counts.stale,
    iosTestCohortTasks('core-integration').flatMap((task) => task.identifiers).length,
  );
  assert.equal(stale.firstFailures.length, 0);
  assert.equal(stale.staleReports[0].attempt, '1');
});

test('invalid selection becomes unknown coverage instead of an implicit full run', () => {
  const summary = summarize([], { selectedCohorts: ['unknown-cohort'] });
  const expected = IOS_TEST_COHORT_NAMES.filter((cohort) => cohort !== 'speech').flatMap((cohort) =>
    iosTestCohortTasks(cohort).flatMap((task) => task.identifiers),
  ).length;
  assert.equal(summary.selection.valid, false);
  assert.equal(summary.coverage.ordinaryIphone.counts.unknown, expected);
  assert.equal(summary.selectedCaseCount, 0);
});

test('candidate selection stays separate from Full authentication, OAuth, Production and inventory coverage', () => {
  const summary = summarize([], {
    selectedCohorts: ['core-integration'],
    validationTier: 'candidate',
    oauthRequired: true,
    executionResults: {
      production_validation: { result: 'success' },
      oauth_products: { result: 'success' },
      oauth_execution: { result: 'success' },
      authentication: { result: 'success' },
    },
  });

  assert.equal(summary.selection.validationTier, 'candidate');
  assert.equal(summary.selection.fullInventorySelected, false);
  assert.equal(summary.coverage.authentication.selected, false);
  assert.equal(summary.coverage.authentication.jobStatus, 'not-selected');
  assert.equal(summary.coverage.oauth.selected, false);
  assert.equal(summary.coverage.oauth.status, 'not-selected');
  assert.equal(summary.coverage.production.selected, false);
  assert.equal(summary.coverage.production.status, 'not-selected');
});

test('successful jobs with absent receipts report missing cases, not unexecuted cases', () => {
  const [core] = iosTestExecutionPlan(['core-integration']);
  const executor = core.configuration === 'Debug' ? 'debug_execution' : 'release_execution';
  const summary = summarize([], {
    validationTier: 'full',
    executionResults: {
      [executor]: { result: 'success' },
      authentication: { result: 'success' },
      oauth_products: { result: 'success' },
      oauth_execution: { result: 'success' },
      production_validation: { result: 'success' },
    },
  });

  const selectedCoreCases = iosTestCohortTasks('core-integration').flatMap(
    (task) => task.identifiers,
  ).length;
  const authenticationCases = iosTestInventory('core', 'authentication').length;
  assert.equal(summary.coverage.ordinaryIphone.counts.missing, selectedCoreCases);
  assert.equal(summary.coverage.ordinaryIphone.counts.unexecuted, 0);
  assert.equal(summary.coverage.authentication.counts.missing, authenticationCases);
  assert.equal(summary.coverage.authentication.counts.unexecuted, 0);
});
