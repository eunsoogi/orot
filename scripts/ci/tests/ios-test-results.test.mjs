import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { readIosTestObservations, verifyIosTestResults } from '../ios-test-results.mjs';

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

test('preserves a failed individual run even when the test summary reports a later pass', () => {
  const failureReport = report('Passed');
  failureReport.testNodes[0].children[0].children = [
    {
      nodeType: 'Test Case Run',
      result: 'Failed',
      durationInSeconds: 0.5,
      children: [
        {
          nodeType: 'Failure Message',
          name: 'XCTAssertEqual failed: expected value',
          sourceLocation: {
            filePath: join(
              process.cwd(),
              'apps/mobile/ios/OrotIntegrationTests/SpeechIntegrationTests.swift',
            ),
            lineNumber: 41,
          },
        },
      ],
    },
  ];

  assert.deepEqual(readIosTestObservations(failureReport), [
    {
      identifier,
      result: 'Failed',
      duration: 0.5,
      failure: {
        message: 'XCTAssertEqual failed: expected value',
        sourceLocation: {
          filePath: 'apps/mobile/ios/OrotIntegrationTests/SpeechIntegrationTests.swift',
          lineNumber: 41,
        },
      },
    },
  ]);
  assert.throws(() => verifyIosTestResults(failureReport, [identifier]));
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
