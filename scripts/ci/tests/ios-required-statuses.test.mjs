import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { IOS_TEST_COHORT_NAMES } from '../ios-test-execution-plan.mjs';
import { REQUIRED_CI_JOBS_BY_WORKFLOW } from '../../release/ci-required-jobs.mjs';

const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('eslint/package.json'))('js-yaml');
const readWorkflow = (name) =>
  yaml.load(readFileSync(new URL('../../../.github/workflows/' + name, import.meta.url), 'utf8'));
const workflow = readWorkflow('ios-required-statuses.yml');
const status = workflow.jobs.status;
const caller = readWorkflow('e2e-test.yml').jobs.required_statuses;
const checkCohorts = Object.fromEntries(
  status.strategy.matrix.include.map(({ check, cohorts }) => [check, cohorts]),
);

test('five domain statuses preserve their required check names and map affected cohorts', () => {
  assert.equal(caller.uses, './.github/workflows/ios-required-statuses.yml');
  assert.equal(caller.if, 'always()');
  assert.deepEqual(caller.needs, ['selection', 'completeness']);
  assert.match(caller.name, /non_protected_contexts/);
  assert.deepEqual(Object.keys(workflow.jobs), ['status']);
  assert.equal(status.name, '${{ matrix.check }}');
  assert.equal(status.if, 'always()');
  assert.equal(status['runs-on'], 'ubuntu-24.04');
  assert.equal(status.strategy['fail-fast'], false);
  assert.deepEqual(Object.keys(checkCohorts), ['UI', 'Storage', 'Provider', 'Speech', 'Questions']);

  const names = Object.keys(checkCohorts).map((name) => 'Validate / ' + name);
  assert.deepEqual(names, REQUIRED_CI_JOBS_BY_WORKFLOW['.github/workflows/e2e-test.yml'].slice(1));
  for (const cohort of IOS_TEST_COHORT_NAMES)
    assert.ok(
      Object.values(checkCohorts).some((cohorts) => cohorts.includes(cohort)),
      cohort,
    );
});

function evaluate(check, { selected, result, cohorts, invalid = false, deferred = false }) {
  const guard = status.steps[0];
  const outcome = spawnSync('/bin/bash', ['-c', guard.run], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SELECTED: String(selected),
      EXECUTION_RESULT: result,
      SELECTED_COHORTS: JSON.stringify(cohorts),
      // The workflow matrix already supplies this field as JSON text.
      CHECK_COHORTS: checkCohorts[check],
      INVALID: String(invalid),
      NON_PROTECTED_CONTEXTS: String(deferred),
      CHECK_NAME: check,
    },
  });
  return outcome;
}

test('affected domains require successful complete selected execution and unrelated domains retain their own result', () => {
  assert.equal(
    evaluate('Storage', { selected: true, result: 'success', cohorts: ['backup'] }).status,
    0,
  );
  assert.notEqual(
    evaluate('Storage', { selected: true, result: 'failure', cohorts: ['backup'] }).status,
    0,
  );
  assert.equal(
    evaluate('UI', { selected: true, result: 'failure', cohorts: ['backup'] }).status,
    0,
  );

  for (const result of ['failure', 'cancelled', 'skipped', ''])
    assert.notEqual(
      evaluate('Questions', { selected: true, result, cohorts: ['questions'] }).status,
      0,
    );
  assert.notEqual(
    evaluate('Provider', {
      selected: true,
      result: 'success',
      cohorts: ['questions'],
      invalid: true,
    }).status,
    0,
  );
});

test('empty ready selections pass only as explicit exclusions; drafts use a separate check name', () => {
  assert.equal(evaluate('UI', { selected: false, result: 'skipped', cohorts: [] }).status, 0);
  assert.notEqual(evaluate('UI', { selected: false, result: 'success', cohorts: [] }).status, 0);
  assert.notEqual(
    evaluate('UI', { selected: false, result: 'skipped', cohorts: ['provider'] }).status,
    0,
  );
  assert.equal(
    evaluate('UI', { selected: false, result: 'skipped', cohorts: ['provider'], deferred: true })
      .status,
    0,
  );
});
