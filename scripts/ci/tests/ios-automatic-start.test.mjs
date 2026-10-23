import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('eslint/package.json'))('js-yaml');
const read = (name) => yaml.load(readFileSync('.github/workflows/' + name, 'utf8'));

// The non-E2E workflows retain their existing source-validation events.
for (const name of ['code-quality.yml', 'unit-test.yml', 'policy-check.yml']) {
  test(`${name} keeps its static pull request, main push, and manual entry points`, () => {
    const triggers = read(name).on;
    assert.deepEqual(triggers.pull_request.types, ['opened', 'synchronize', 'reopened']);
    assert.equal(triggers.pull_request.branches, undefined);
    assert.deepEqual(triggers.push.branches, ['main']);
    assert.equal(Object.hasOwn(triggers, 'workflow_dispatch'), true);
  });
}

// GitHub parses these event bytes; separate assertions cover whether the jobs allocate Mac runners.
test('full E2E listens only to the daily main schedule', () => {
  const e2e = read('e2e-test.yml');
  assert.deepEqual(Object.keys(e2e.on), ['schedule']);
  assert.deepEqual(e2e.on.schedule, [{ cron: '0 18 * * *' }]);
  assert.equal(e2e.permissions['pull-requests'], undefined);
  assert.deepEqual(e2e.concurrency, {
    group: 'ios-ci-macos-${{ github.repository }}',
    queue: 'max',
    'cancel-in-progress': false,
  });
});

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

test('full E2E retains all validation dependencies and skips only unselected configurations', () => {
  const full = read('e2e-test.yml');
  assertAutomaticGraph('e2e-test.yml');
  assert.equal(full.jobs.plan['runs-on'], 'ubuntu-24.04');
  assert.equal(full.jobs.plan['continue-on-error'], undefined);
  assert.match(full.jobs.plan.if, /needs\.selection\.outputs\.run_ios == 'true'/);
  assert.equal(full.jobs.production_validation.needs, 'plan');
  assert.equal(full.jobs.debug_products.needs, 'plan');
  assert.equal(full.jobs.oauth_products.needs, 'plan');
  assert.equal(full.jobs.oauth_products.if, "${{ needs.plan.outputs.oauth_required == 'true' }}");
  assert.deepEqual(full.jobs.oauth_execution.needs, ['plan', 'oauth_products']);
  assert.deepEqual(full.jobs.debug_execution.needs, ['plan', 'debug_products']);
  assert.equal(full.jobs.debug_execution.if, "${{ needs.plan.outputs.has_debug == 'true' }}");
  assert.equal(full.jobs.release_products.if, "${{ needs.plan.outputs.has_release == 'true' }}");
  assert.deepEqual(full.jobs.release_execution.needs, ['plan', 'release_products']);
  assert.equal(full.jobs.release_execution.if, "${{ needs.plan.outputs.has_release == 'true' }}");
  assert.equal(full.jobs.focused_scenario, undefined);
  assert.equal(full.on.workflow_call, undefined);
});

test('focused E2E has no public entry point while its reusable workflow remains internally valid', () => {
  assert.equal(existsSync('.github/workflows/e2e-selected.yml'), false);
  const callers = readdirSync('.github/workflows')
    .filter((name) => name.endsWith('.yml'))
    .flatMap((name) =>
      Object.entries(read(name).jobs).filter(([, job]) => job.uses === './.github/workflows/ios-focused.yml'),
    );
  assert.deepEqual(callers, []);

  const focus = read('ios-focused.yml');
  assert.deepEqual(Object.keys(focus.on), ['workflow_call']);
  assertAutomaticGraph('ios-focused.yml');
  assert.equal(focus.jobs.selection['runs-on'], 'ubuntu-24.04');
  assert.equal(focus.jobs.selection['continue-on-error'], undefined);
  assert.equal(focus.jobs.products.needs, 'selection');
});
