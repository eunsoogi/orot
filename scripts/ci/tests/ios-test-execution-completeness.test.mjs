import assert from 'node:assert/strict';
import test from 'node:test';
import { IOS_TEST_COHORT_NAMES, iosTestExecutionPlan } from '../ios-test-execution-plan.mjs';
import { validateIosTestExecutionResults } from '../ios-test-execution-completeness.mjs';

function resultsFor(selectedCohorts, oauthRequired) {
  const plan = iosTestExecutionPlan(selectedCohorts);
  const debug = plan.some((entry) => entry.configuration === 'Debug');
  const release = plan.some((entry) => entry.configuration === 'Release');
  return {
    plan: { result: 'success' },
    production_validation: { result: 'success' },
    oauth_products: { result: oauthRequired ? 'success' : 'skipped' },
    oauth_execution: { result: oauthRequired ? 'success' : 'skipped' },
    debug_products: { result: debug ? 'success' : 'skipped' },
    release_products: { result: release ? 'success' : 'skipped' },
    debug_execution: { result: debug ? 'success' : 'skipped' },
    release_execution: { result: release ? 'success' : 'skipped' },
  };
}

test('full release dispatch requires every producer and executor, including separate OAuth', () => {
  const results = resultsFor(IOS_TEST_COHORT_NAMES, true);

  assert.doesNotThrow(() => validateIosTestExecutionResults(results, IOS_TEST_COHORT_NAMES, true));
});

test('a focused selection explicitly skips unused configurations and OAuth jobs', () => {
  const selected = ['backup'];
  const results = resultsFor(selected, false);

  assert.doesNotThrow(() => validateIosTestExecutionResults(results, selected, false));
  assert.throws(
    () =>
      validateIosTestExecutionResults(
        { ...results, debug_products: { result: 'success' } },
        selected,
        false,
      ),
    /debug_products expected skipped/,
  );
});

test('every selected producer and executor fails closed when failed, cancelled, skipped or missing', () => {
  const selected = ['backup'];
  const successful = resultsFor(selected, false);

  for (const job of ['plan', 'production_validation', 'release_products', 'release_execution']) {
    for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
      const current = structuredClone(successful);
      if (result === undefined) delete current[job];
      else current[job].result = result;

      assert.throws(
        () => validateIosTestExecutionResults(current, selected, false),
        new RegExp(job + ' expected success'),
      );
    }
  }
});

test('invalid selections, inconsistent OAuth and unexpected job results are rejected', () => {
  const selected = ['backup'];
  const results = resultsFor(selected, false);

  for (const selection of [[], ['unknown'], ['backup', 'backup']])
    assert.throws(() => validateIosTestExecutionResults(results, selection, false));
  assert.throws(() => validateIosTestExecutionResults(results, selected, 'false'));
  assert.throws(() =>
    validateIosTestExecutionResults(
      { ...results, unexpected: { result: 'skipped' } },
      selected,
      false,
    ),
  );
});
