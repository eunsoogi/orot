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
  assert.deepEqual(Object.keys(reusable.on), ['workflow_call']);
  const callInputs = reusable.on.workflow_call.inputs;
  assert.deepEqual(callInputs.report_only, { required: false, type: 'boolean', default: false });
  for (const name of ['source_run_id', 'source_attempt'])
    assert.deepEqual(callInputs[name], { required: false, type: 'string' });

  // The called workflow selects its path by explicit input, not the caller's event name.
  assert.equal(reusable.jobs.completeness.if, '${{ always() && !inputs.report_only }}');
  const replay = reusable.jobs.report_archived_summary;
  assert.equal(replay.if, '${{ inputs.report_only }}');
  assert.equal(replay['runs-on'], 'ubuntu-24.04');
  const replaySteps = replay.steps;
  const selectionDownload = replaySteps.find(
    (step) => step.name === 'Download the exact source selection manifest',
  );
  const publish = replaySteps.find(
    (step) => step.name === 'Publish the archived run report on this Linux workflow run',
  );
  const sourceCheckout = replaySteps.find((step) => step.name === 'Check out the source inventory');
  const upload = replaySteps.find(
    (step) => step.name === 'Preserve the source report and its separate publisher identity',
  );
  assert.equal(selectionDownload.with['run-id'], '${{ inputs.source_run_id }}');
  assert.equal(
    selectionDownload.with.name,
    'ios-e2e-selection-${{ inputs.source_run_id }}-${{ inputs.source_attempt }}',
  );
  assert.equal(publish.env.OROT_IOS_SOURCE_RUN_ID, '${{ inputs.source_run_id }}');
  assert.equal(publish.env.OROT_IOS_SOURCE_ATTEMPT, '${{ inputs.source_attempt }}');
  assert.equal(sourceCheckout.with.ref, '${{ steps.source.outputs.sha }}');
  assert.equal(sourceCheckout.with.path, 'artifacts/ios-source');
  assert.match(
    publish.run,
    /artifacts\/ios-source-selection\/ios-e2e-selection\.json artifacts\/ios-source$/,
  );
  assert.match(
    upload.with.name,
    /source-\$\{\{ inputs\.source_run_id \}\}-\$\{\{ inputs\.source_attempt \}\}-publisher-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/,
  );

  assert.equal(caller.jobs.completeness.with.report_only, "${{ inputs.mode == 'report' }}");
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
  assert.equal(
    workflow.jobs.completeness.if,
    "${{ always() && (needs.plan.result != 'skipped' || inputs.mode == 'report') }}",
  );
});
