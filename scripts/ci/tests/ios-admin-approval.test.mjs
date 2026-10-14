import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('eslint/package.json'))('js-yaml');
const read = (name) => yaml.load(readFileSync('.github/workflows/' + name, 'utf8'));
const environment = 'ios-ci-admin-approval';

// The real reviewer protection is repository state. These graph checks prove only that every expensive path reaches its approval job first.
function assertApproval(job) {
  assert.equal(job['runs-on'], 'ubuntu-24.04');
  assert.equal(job.environment?.name, environment);
  assert.equal(job['continue-on-error'], undefined);
}

test('automatic full validation approves Linux planning before both independent producers and every Speech successor', () => {
  const full = read('ios-test-validation.yml');
  assertApproval(full.jobs.plan);
  assert.equal(full.jobs.debug_execution.needs, 'plan');
  assert.equal(full.jobs.release_execution.needs, 'plan');
  assert.deepEqual(full.jobs.speech_execution.needs, [
    'plan',
    'debug_execution',
    'release_execution',
  ]);
  assert.equal(full.on.workflow_dispatch, undefined);
  assert.ok(Object.hasOwn(full.on, 'workflow_call'));
});

test('focused diagnostics cannot bypass the same administrator approval', () => {
  const focus = read('ios-focused.yml');
  assertApproval(focus.jobs.selection);
  assert.equal(focus.jobs.products.needs, 'selection');
});

test('draft PRs reach automatic approval while manual full dispatch cannot allocate Macs', () => {
  const e2e = read('e2e-test.yml');
  assert.ok(e2e.on.pull_request.types.includes('synchronize'));
  assert.deepEqual(e2e.on.push.branches, ['main']);
  assert.doesNotMatch(e2e.jobs.ios_validation.if, /outputs\.deferred != 'true'/);
  assert.match(e2e.jobs.ios_validation.if, /github\.event_name != 'workflow_dispatch'/);
  assert.match(e2e.jobs.ios_validation.if, /outputs\.focused != 'true'/);
  // A drafted, rejected, missing or skipped execution remains deferred; only a completed full result can clear that flag.
  const condition =
    "needs.selection.outputs.deferred == 'true' && needs.ios_validation.result != 'success'";
  assert.ok(e2e.jobs.ios_simulator_build.steps[0].env.DEFERRED.includes(condition));
  assert.ok(e2e.jobs.required_statuses.with.invalid_selection.includes(condition));
  assert.ok(e2e.jobs.required_statuses.with.invalid_selection.includes("diagnostic == 'true'"));
});
