import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyIosTestResults } from '../ios-test-results.mjs';

const identifier = 'OrotIntegrationTests/SpeechIntegrationTests/testMedicationFixture';
const report = (result) => ({
  testNodes: [
    {
      nodeType: 'Unit test bundle',
      name: 'OrotIntegrationTests',
      children: [
        {
          nodeType: 'Test Case',
          nodeIdentifier: identifier + '()',
          result,
          durationInSeconds: 3,
        },
      ],
    },
  ],
});
test('accepts an observed first-attempt pass for the exact selected inventory', () => {
  assert.equal(verifyIosTestResults(report('Passed'), [identifier]).length, 1);
});
test('rejects missing, skipped and failed tests', () => {
  for (const result of ['Skipped', 'Failed', 'Expected Failure', undefined])
    assert.throws(() => verifyIosTestResults(report(result), [identifier]));
  assert.throws(() => verifyIosTestResults({ testNodes: [] }, [identifier]));
});
test('rejects duplicate retry results and unexpected execution', () => {
  const duplicate = report('Passed');
  duplicate.testNodes[0].children.push(duplicate.testNodes[0].children[0]);
  assert.throws(() => verifyIosTestResults(duplicate, [identifier]));
  assert.throws(() => verifyIosTestResults(report('Passed'), [identifier, identifier + 'Other']));
});

test('rejects a passing summary that contains a failed attempt or repetition', () => {
  for (const child of [
    { nodeType: 'Test Case Run', result: 'Failed' },
    { nodeType: 'Repetition', result: 'Passed' },
  ]) {
    const attempts = report('Passed');
    attempts.testNodes[0].children[0].children = [child];
    assert.throws(() => verifyIosTestResults(attempts, [identifier]));
  }
});
