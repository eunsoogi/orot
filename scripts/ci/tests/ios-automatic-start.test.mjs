import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('eslint/package.json'))('js-yaml');
const read = (name) => yaml.load(readFileSync('.github/workflows/' + name, 'utf8'));
// Follow reusable CI workflows too: adding an environment below the caller would silently restore a deployment approval gate.
function assertAutomaticGraph(name, visited = new Set()) {
  if (visited.has(name)) return;
  visited.add(name);
  for (const [id, job] of Object.entries(read(name).jobs)) {
    assert.equal(
      job.environment,
      undefined,
      `${name}/${id} must start without deployment approval`,
    );
    if (job.uses?.startsWith('./.github/workflows/'))
      assertAutomaticGraph(job.uses.split('/').at(-1), visited);
  }
}

test('automatic full validation plans coverage without deployment approval and retains every required dependency', () => {
  const full = read('ios-test-validation.yml');
  assertAutomaticGraph('e2e-test.yml');
  assert.equal(full.jobs.plan['runs-on'], 'ubuntu-24.04');
  assert.equal(full.jobs.plan['continue-on-error'], undefined);
  assert.equal(full.jobs.production_validation.needs, 'plan');
  assert.equal(full.jobs.debug_execution.needs, 'plan');
  assert.equal(full.jobs.release_products.needs, 'plan');
  assert.deepEqual(full.jobs.release_core.needs, ['plan', 'release_products']);
  assert.deepEqual(full.jobs.release_ui.needs, ['plan', 'release_products']);
  assert.deepEqual(full.jobs.speech_execution.needs, ['plan', 'release_products']);
  assert.equal(full.on.workflow_dispatch, undefined);
  assert.ok(Object.hasOwn(full.on, 'workflow_call'));
});

test('focused diagnostics start automatically after Linux selection without a deployment environment', () => {
  const focus = read('ios-focused.yml');
  assertAutomaticGraph('ios-focused.yml');
  assert.equal(focus.jobs.selection['runs-on'], 'ubuntu-24.04');
  assert.equal(focus.jobs.selection['continue-on-error'], undefined);
  assert.equal(focus.jobs.products.needs, 'selection');
});

test('draft PR updates and main pushes start full CI while manual diagnostics cannot satisfy it', () => {
  const e2e = read('e2e-test.yml');
  assert.ok(e2e.on.pull_request.types.includes('synchronize'));
  assert.deepEqual(e2e.on.push.branches, ['main']);
  assert.doesNotMatch(e2e.jobs.ios_validation.if, /outputs\.deferred != 'true'/);
  assert.match(e2e.jobs.ios_validation.if, /github\.event_name != 'workflow_dispatch'/);
  assert.match(e2e.jobs.ios_validation.if, /outputs\.focused != 'true'/);
  // Draft state cannot bypass validation: only a completed full result clears the deferred flag.
  const condition =
    "needs.selection.outputs.deferred == 'true' && needs.ios_validation.result != 'success'";
  assert.ok(e2e.jobs.ios_simulator_build.steps[0].env.DEFERRED.includes(condition));
  assert.ok(e2e.jobs.required_statuses.with.invalid_selection.includes(condition));
  assert.ok(e2e.jobs.required_statuses.with.invalid_selection.includes("diagnostic == 'true'"));
});
