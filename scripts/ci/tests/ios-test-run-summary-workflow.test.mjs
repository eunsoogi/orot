import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('eslint/package.json'))('js-yaml');

test('diagnostic report publication cannot change the strict completeness result', () => {
  const workflow = yaml.load(readFileSync('.github/workflows/ios-test-completeness.yml', 'utf8'));
  const steps = workflow.jobs.completeness.steps;
  const publishIndex = steps.findIndex(
    (step) => step.name === 'Publish the non-gating coverage and timing report',
  );
  const uploadIndex = steps.findIndex(
    (step) => step.name === 'Preserve the diagnostic summary separately from strict completeness',
  );
  const verifyIndex = steps.findIndex(
    (step) =>
      step.name === 'Verify every planned first attempt and authentic Speech and Keychain evidence',
  );

  assert.ok(publishIndex >= 0 && uploadIndex > publishIndex && verifyIndex > uploadIndex);
  assert.equal(steps[publishIndex]['continue-on-error'], true);
  assert.equal(steps[uploadIndex]['continue-on-error'], true);
  assert.equal(steps[verifyIndex]['continue-on-error'], undefined);
  const artifactDownloads = steps.filter((step) =>
    step.uses?.startsWith('actions/download-artifact@'),
  );
  assert.equal(artifactDownloads.length, 2);
  for (const download of artifactDownloads) assert.equal(download['continue-on-error'], true);
  assert.equal(steps[publishIndex].env.GITHUB_TOKEN, '${{ github.token }}');
  assert.equal(steps[publishIndex].env.OROT_IOS_TEST_COHORTS, '${{ inputs.selected_cohorts }}');
  const caller = yaml.load(readFileSync('.github/workflows/e2e-test.yml', 'utf8'));
  assert.deepEqual(caller.jobs.completeness.permissions, {
    actions: 'read',
    contents: 'read',
  });

  const reusable = yaml.load(readFileSync('.github/workflows/ios-test-completeness.yml', 'utf8'));
  assert.deepEqual(reusable.permissions, { actions: 'read', contents: 'read' });
});

test('candidate selection stays on its focused workflow and does not enter the Full summary caller', () => {
  const workflow = yaml.load(readFileSync('.github/workflows/e2e-test.yml', 'utf8'));
  assert.equal(workflow.jobs.candidate.uses, './.github/workflows/ios-candidate.yml');
  assert.equal(workflow.jobs.completeness.uses, './.github/workflows/ios-test-completeness.yml');
  assert.equal(
    workflow.jobs.completeness.with.validation_tier,
    '${{ needs.selection.outputs.validation_tier }}',
  );
  assert.match(workflow.jobs.plan.if, /needs\.selection\.outputs\.run_ios == 'true'/);
  assert.equal(workflow.jobs.completeness.if, "${{ always() && needs.plan.result != 'skipped' }}");
});
