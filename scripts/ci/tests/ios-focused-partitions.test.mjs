import assert from 'node:assert/strict';
import test from 'node:test';
import {
  focusedIosTestCohorts,
  selectFocusedIosTests,
  verifyFocusedIosJobResults,
} from '../ios-focused-selection.mjs';

// A group remains an exact diagnostic union while native work uses the full plan's bounded leaves.
test('focused aggregate groups retain their exact original methods across independent jobs', () => {
  for (const [group, count] of [
    ['navigation', 4],
    ['calendar', 2],
    ['questions', 5],
    ['recordings', 3],
    ['all', 14],
  ]) {
    const selection = selectFocusedIosTests(
      'ios/fixtures',
      'scripts/ci/ios-test-fixture-groups.mjs',
      group === 'all' ? 'all' : `group/${group}`,
    );
    assert.equal(focusedIosTestCohorts(selection).length, count);
    for (const identifiers of [
      selection.identifiers.slice(1),
      [...selection.identifiers, selection.identifiers[0]],
    ])
      assert.throws(() => focusedIosTestCohorts({ ...selection, identifiers }), /exact requested/);
  }
});

test('focused completion rejects failed, omitted or incorrectly skipped execution routes', () => {
  for (const cohorts of [null, ['speech'], ['navigation-routes', 'navigation-routes']])
    assert.throws(() => verifyFocusedIosJobResults({}, cohorts));
  for (const cohorts of [[], ['navigation-features', 'navigation-routes', 'navigation-imports']]) {
    const results = Object.fromEntries(
      Object.entries({
        selection: 'success',
        products: 'success',
        execution: cohorts.length ? 'skipped' : 'success',
        fixture_execution: cohorts.length ? 'success' : 'skipped',
      }).map(([name, result]) => [name, { result }]),
    );
    assert.doesNotThrow(() => verifyFocusedIosJobResults(results, cohorts));
    for (const key of Object.keys(results)) {
      const missing = { ...results };
      delete missing[key];
      assert.throws(() => verifyFocusedIosJobResults(missing, cohorts));
      for (const result of ['failure', 'cancelled', 'skipped', 'success'].filter(
        (value) => value !== results[key].result,
      ))
        assert.throws(() => verifyFocusedIosJobResults({ ...results, [key]: { result } }, cohorts));
    }
    assert.throws(() =>
      verifyFocusedIosJobResults({ ...results, unexpected: { result: 'success' } }, cohorts),
    );
  }
});
