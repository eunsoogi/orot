import assert from 'node:assert/strict';
import test from 'node:test';
import { iosTestExecutionPlan } from '../ios-test-execution-plan.mjs';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';
import { iosTestInventory } from '../ios-test-inventory.mjs';
import { cohortJobs, workflow } from './fixtures/ios-workflow.mjs';

const cohorts = ['questions-conversation', 'questions-accessibility'];
const composer =
  'OrotUITests/KeyboardSafeAreaUITests/testConversationOutputComposerAndSwipeUndoAcrossAppearances';

test('Conversation methods have two independent 20-minute jobs in Full and selected graphs', () => {
  const expected = iosTestInventory('fixtures', 'questions').filter((id) =>
    id.includes('/KeyboardSafeAreaUITests/'),
  );
  assert.equal(expected.length, 3);
  const full = iosTestExecutionPlan();
  assert.equal(full.length, 27);
  const selected = iosTestExecutionPlan(cohorts);
  assert.equal(selected.length, 2);
  for (const cohort of cohorts)
    assert.deepEqual(
      iosTestExecutionPlan([cohort]),
      full.filter((job) => job.cohort === cohort),
    );
  const identifiers = selected.flatMap(({ cohort, minutes }) => {
    assert.equal(minutes, 20);
    const tasks = iosTestCohortTasks(cohort);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].profile, 'fixtures');
    assert.equal(tasks[0].suite, 'questions');
    assert.equal(tasks[0].mode, 'fixture');
    return tasks[0].identifiers;
  });
  assert.deepEqual(identifiers.slice().sort(), expected.slice().sort());
  assert.equal(new Set(identifiers).size, 3);
  // The long composer/appearance journey gets its own budget; no method is cut into phases.
  assert.deepEqual(iosTestCohortTasks(cohorts[0])[0].identifiers, [composer]);
  assert.equal(iosTestCohortTasks(cohorts[1])[0].identifiers.length, 2);
  const actual = full.flatMap(({ cohort }) =>
    iosTestCohortTasks(cohort).flatMap((task) => task.identifiers),
  );
  assert.equal(actual.length, 147);
  assert.equal(new Set(actual).size, 147);

  const jobs = cohortJobs(workflow('.github/workflows/e2e-test.yml').jobs);
  for (const cohort of cohorts) {
    const matches = jobs.filter(([, { inputs }]) => inputs.cohort === cohort);
    assert.equal(matches.length, 1);
    const { leaf } = matches[0][1];
    assert.equal(leaf.needs, undefined);
    assert.equal(leaf.strategy, undefined);
    assert.equal(leaf['timeout-minutes'], 20);
    assert.equal(leaf.if, "${{ contains(fromJSON(inputs.cohorts), '" + cohort + "') }}");
    assert.ok(leaf.steps.some((step) => step.with?.cohort === cohort && step.if === 'always()'));
  }
});

// Independent whole-method budgets preserve fresh installation and result finalization.
test('Summary and Literature own separate complete methods and hosted budgets', () => {
  const cohorts = ['questions-summary', 'questions-literature'];
  const expected = iosTestInventory('fixtures', 'questions').filter((id) =>
    id.includes('/SummaryAndLiteratureUITests/'),
  );
  assert.equal(expected.length, 2);
  const full = iosTestExecutionPlan();
  const selected = iosTestExecutionPlan(cohorts);
  assert.equal(full.length, 27);
  assert.equal(selected.length, 2);
  const actual = cohorts.flatMap((cohort) => {
    assert.deepEqual(
      iosTestExecutionPlan([cohort]),
      full.filter((job) => job.cohort === cohort),
    );
    const tasks = iosTestCohortTasks(cohort);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].mode, 'fixture');
    assert.equal(tasks[0].suite, 'questions');
    assert.equal(tasks[0].identifiers.length, 1);
    return tasks[0].identifiers;
  });
  assert.deepEqual(actual.slice().sort(), expected.slice().sort());
  assert.equal(new Set(actual).size, 2);
  const jobs = cohortJobs(workflow('.github/workflows/e2e-test.yml').jobs);
  for (const cohort of cohorts) {
    const matches = jobs.filter(([, { inputs }]) => inputs.cohort === cohort);
    assert.equal(matches.length, 1);
    const { leaf } = matches[0][1];
    assert.equal(leaf.needs, undefined);
    assert.equal(leaf.strategy, undefined);
    assert.equal(leaf['timeout-minutes'], 20);
    assert.equal(leaf.if, "${{ contains(fromJSON(inputs.cohorts), '" + cohort + "') }}");
    assert.equal(selected.find((job) => job.cohort === cohort).minutes, 20);
    assert.ok(leaf.steps.some((step) => step.with?.cohort === cohort && step.if === 'always()'));
  }
  const all = full.flatMap(({ cohort }) =>
    iosTestCohortTasks(cohort).flatMap((task) => task.identifiers),
  );
  assert.equal(all.length, 147);
  assert.equal(new Set(all).size, 147);
});
