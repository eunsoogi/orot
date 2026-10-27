import assert from 'node:assert/strict';
import test from 'node:test';
import { workflow, expandedActionSteps } from './fixtures/ios-workflow.mjs';

test('an encounter-only selection is reachable through the existing Release recording workflow with exact product digests', () => {
  const parent = workflow('.github/workflows/ios-release-tests.yml').jobs.recordings;
  assert.equal(parent.uses, './.github/workflows/ios-recording-tests.yml');
  assert.equal(
    parent.if,
    "${{ contains(inputs.cohorts, 'recordings-') || contains(fromJSON(inputs.cohorts), 'encounter-review-persistence') }}",
  );
  for (const input of ['artifact_name', 'archive_digest', 'manifest_digest', 'cohorts'])
    assert.equal(parent.with[input], '${{ inputs.' + input + ' }}');
  const child = workflow('.github/workflows/ios-recording-tests.yml');
  assert.deepEqual(child.permissions, { contents: 'read' });
  const job = child.jobs.encounter_review_persistence;
  assert.equal(job.if, "${{ contains(fromJSON(inputs.cohorts), 'encounter-review-persistence') }}");
  assert.equal(job['runs-on'], 'xcode-27');
  const execute = job.steps.find(
    (step) => step.uses === './.github/actions/ios-test-cohort-executor',
  );
  assert.equal(execute.with.cohort, 'encounter-review-persistence');
  assert.equal(execute.with.profile, 'core');
  for (const input of ['artifact_name', 'archive_digest', 'manifest_digest'])
    assert.equal(execute.with[input], '${{ inputs.' + input + ' }}');
  const closure = expandedActionSteps('./.github/actions/ios-test-cohort-executor/action.yml');
  assert.doesNotMatch(JSON.stringify(closure), /pnpm|ios-native-toolchain/);
  assert.ok(closure.some((step) => step.uses?.startsWith('actions/download-artifact@')));
});

test('the independent persistence cohort contributes to the existing Storage status without a new protection check', () => {
  const matrix = workflow('.github/workflows/ios-required-statuses.yml').jobs.status.strategy.matrix
    .include;
  assert.deepEqual(
    matrix.map((item) => item.check),
    ['UI', 'Storage', 'Provider', 'Speech', 'Questions'],
  );
  assert.ok(
    JSON.parse(matrix.find((item) => item.check === 'Storage').cohorts).includes(
      'encounter-review-persistence',
    ),
  );
});
