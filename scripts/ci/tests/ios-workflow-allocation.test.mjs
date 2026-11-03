import assert from 'node:assert/strict';
import test from 'node:test';
import { workflow } from './fixtures/ios-workflow.mjs';

test('full and focused execution retain one repository allocation window and separate build and test jobs', () => {
  const full = workflow('.github/workflows/e2e-test.yml');
  assert.deepEqual(full.concurrency, {
    group:
      "${{ github.event_name == 'workflow_dispatch' && inputs.mode == 'report' && format('ios-ci-report-{0}', github.run_id) || format('ios-ci-macos-{0}', github.repository) }}",
    queue: 'max',
    'cancel-in-progress': false,
  });
  const focus = workflow('.github/workflows/ios-focused.yml');
  assert.equal(focus.jobs.selection.uses, './.github/workflows/ios-focused-selection.yml');
  assert.equal(
    workflow('.github/workflows/ios-focused-selection.yml').jobs.selection['runs-on'],
    'ubuntu-24.04',
  );
  assert.equal(focus.jobs.completeness['runs-on'], 'ubuntu-24.04');
  assert.equal(focus.jobs.products.needs, 'selection');
  assert.equal(focus.jobs.execution.needs, 'products');
  assert.equal(Object.values(focus.jobs).filter((job) => job['runs-on'] === 'xcode-27').length, 2);
  for (const id of ['products', 'execution']) assert.equal(focus.jobs[id].concurrency, undefined);
});
