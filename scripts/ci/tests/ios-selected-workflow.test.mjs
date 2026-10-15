import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import test from 'node:test';
import { REQUIRED_CI_JOBS } from '../../release/ci-required-jobs.mjs';
import { workflow } from './fixtures/ios-workflow.mjs';

const directory = '.github/workflows/';
const focusedPath = './.github/workflows/ios-focused.yml';

function selectedEntry() {
  const entries = readdirSync(directory)
    .filter((name) => name.endsWith('.yml'))
    .map((name) => ({ path: directory + name, source: workflow(directory + name) }))
    .filter(
      ({ source }) =>
        Object.hasOwn(source.on, 'workflow_dispatch') &&
        Object.values(source.jobs).some((job) => job.uses === focusedPath),
    );
  assert.equal(entries.length, 1, 'Exactly one manual entry must call focused execution');
  return entries[0];
}

// Inspect every reachable job name: GitHub creates checks even for failed or skipped jobs.
function checkNames(path, parents = [], inputs = {}) {
  return Object.entries(workflow(path).jobs).flatMap(([id, job]) => {
    const name = (job.name ?? id).replace(/\$\{\{ inputs\.(\w+) \}\}/g, (_, key) => inputs[key]);
    const names = [...parents, name];
    if (job.uses) return checkNames(job.uses, names, job.with ?? {});
    return (job.strategy?.matrix?.check ?? [null]).map((check) =>
      names.join(' / ').replace('${{ matrix.check }}', check ?? ''),
    );
  });
}

test('manual selection has an independent entry and cannot create full protected checks', () => {
  const entry = selectedEntry();
  const collisions = checkNames(entry.path).filter((name) => REQUIRED_CI_JOBS.includes(name));
  assert.deepEqual(collisions, [], 'A selected outcome must never replace a full required check');
  assert.equal(entry.path, directory + 'e2e-selected.yml');
  assert.equal(entry.source.name, 'E2E Test - Selected');
  assert.deepEqual(Object.keys(entry.source.on), ['workflow_dispatch']);
  assert.equal(workflow(directory + 'e2e-test.yml').on.workflow_dispatch, undefined);
});

test('selected input forwarding and checks retain clear stages without a full-validation caller', () => {
  const entry = selectedEntry().source;
  assert.deepEqual(Object.keys(entry.jobs), ['selected']);
  const selected = entry.jobs.selected;
  assert.equal(selected.name, 'iOS');
  assert.equal(selected.uses, focusedPath);
  assert.deepEqual(selected.with, {
    pr_number: '${{ inputs.focus_pr_number }}',
    profile: '${{ inputs.focus_profile }}',
    scenario_file: '${{ inputs.focus_scenario_file }}',
    scenario_name: '${{ inputs.focus_scenario_name }}',
  });
  assert.deepEqual(Object.keys(entry.on.workflow_dispatch.inputs), [
    'focus_pr_number',
    'focus_profile',
    'focus_scenario_file',
    'focus_scenario_name',
  ]);
  assert.deepEqual(
    checkNames(directory + 'e2e-selected.yml').sort(),
    [
      'iOS / Build / ${{ needs.selection.outputs.configuration }}',
      'iOS / Plan / Select',
      'iOS / Test / Selection',
      'iOS / Validate / Complete',
    ].sort(),
  );
});

test('full and selected entries share allocation while PR supersession remains separately scoped', () => {
  const entry = selectedEntry().source;
  const full = workflow(directory + 'e2e-test.yml');
  assert.deepEqual(entry.concurrency, full.concurrency);
  assert.deepEqual(entry.concurrency, {
    group: 'ios-ci-macos-${{ github.repository }}',
    'cancel-in-progress': false,
  });
  assert.deepEqual(entry.permissions, { contents: 'read', 'pull-requests': 'read' });
  const focus = workflow(focusedPath);
  const cancellation = workflow(directory + 'cancel-stale-ios-focused.yml').jobs
    .cancel_superseded_focus;
  assert.equal(
    focus.concurrency.group,
    'focused-ios-${{ inputs.pr_number || github.run_id }}-scenario',
  );
  assert.equal(
    cancellation.concurrency.group,
    'focused-ios-${{ github.event.pull_request.number }}-scenario',
  );
  assert.equal(focus.concurrency['cancel-in-progress'], true);
  assert.equal(cancellation.concurrency['cancel-in-progress'], true);
  assert.equal(focus.jobs.products.concurrency, undefined);
  assert.equal(focus.jobs.execution.concurrency, undefined);
});
