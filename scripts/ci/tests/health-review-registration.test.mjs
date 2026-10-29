import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { iosTestInventory } from '../ios-test-inventory.mjs';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';
import { iosTestExecutionPlan } from '../ios-test-execution-plan.mjs';
import { iosTestImpactForPath } from '../ios-test-impact.mjs';
import { workflow } from './fixtures/ios-workflow.mjs';

// The Swift source owns case identities; helpers must compile without adding another execution/reset boundary.
const source = readFileSync('apps/mobile/ios/OrotUITests/HealthReviewUITests.swift', 'utf8');
const identifiers = [...source.matchAll(/func (test\w+)\(/g)].map(
  ([, method]) => 'OrotUITests/HealthReviewUITests/' + method,
);

test('every HealthReview method reaches default Core UI and one independent full-plan task', () => {
  assert.equal(identifiers.length, 8);
  const [task] = iosTestCohortTasks('health-review-ui');
  assert.equal(task.profile, 'core');
  assert.equal(task.suite, 'ui');
  assert.equal(task.mode, 'plain');
  assert.deepEqual(task.identifiers, identifiers);
  for (const id of identifiers) assert.ok(iosTestInventory('core', 'ui').includes(id));
  const full = iosTestExecutionPlan().flatMap(({ cohort }) =>
    iosTestCohortTasks(cohort).flatMap(({ identifiers: values }) => values),
  );
  for (const id of identifiers) assert.equal(full.filter((value) => value === id).length, 1);
  for (const cohort of ['persistence', 'encounter-review-persistence', 'isolation'])
    assert.ok(
      iosTestCohortTasks(cohort).every(({ identifiers: values }) =>
        values.every((id) => !identifiers.includes(id)),
      ),
    );
});

test('HealthReview sources and exact helper select the dedicated cohort', () => {
  for (const path of [
    'apps/mobile/ios/OrotUITests/HealthReviewUITests.swift',
    'apps/mobile/ios/OrotUITests/HealthReviewJourney.swift',
    'apps/mobile/e2e/healthReviewProbeEntry.tsx',
    'apps/mobile/src/healthReview/service.ts',
    'apps/mobile/src/agent/healthReview/evidence.ts',
    'apps/mobile/src/routes/AppRouteContent.tsx',
    'apps/mobile/src/providers/selection.ts',
  ])
    assert.ok(iosTestImpactForPath(path).cohorts.includes('health-review-ui'), path);
});

test('Release workflow forwards verified products and UI status includes HealthReview', () => {
  const parent = workflow('.github/workflows/ios-release-tests.yml').jobs.health_review;
  assert.equal(parent.uses, './.github/workflows/ios-health-review-tests.yml');
  for (const input of ['artifact_name', 'archive_digest', 'manifest_digest', 'cohorts'])
    assert.equal(parent.with[input], '${{ inputs.' + input + ' }}');
  const job = workflow(parent.uses).jobs.health_review_ui;
  assert.equal(job.if, "${{ contains(fromJSON(inputs.cohorts), 'health-review-ui') }}");
  assert.equal(job['timeout-minutes'], 20);
  const execute = job.steps.find(
    ({ uses }) => uses === './.github/actions/ios-test-cohort-executor',
  );
  assert.equal(execute.with.cohort, 'health-review-ui');
  assert.equal(execute.with.profile, 'core');
  const matrix = workflow('.github/workflows/ios-required-statuses.yml').jobs.status.strategy.matrix
    .include;
  assert.ok(
    JSON.parse(matrix.find(({ check }) => check === 'UI').cohorts).includes('health-review-ui'),
  );
  const project = readFileSync('apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj', 'utf8');
  for (const name of ['HealthReviewUITests', 'HealthReviewJourney']) {
    assert.match(project, new RegExp(name + '\\.swift in Sources \\*/ = \\{isa = PBXBuildFile'));
    assert.match(project, new RegExp('path = ' + name + '\\.swift;'));
    assert.equal(project.split(name + '.swift in Sources */').length - 1, 2);
  }
});
