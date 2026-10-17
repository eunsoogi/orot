import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { selectChecksForPaths } from '../changed-paths-select.mjs';
import { resolveFullValidationDeferred } from '../select-changed-paths.mjs';

const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('eslint/package.json'))('js-yaml');
const read = (name) => yaml.load(readFileSync('.github/workflows/' + name, 'utf8'));

// Inspect GitHub's parsed event allowlist. Live absence of new runs still needs
// an observed state transition after these workflow bytes have been published.
for (const name of ['e2e-test.yml', 'code-quality.yml', 'unit-test.yml', 'policy-check.yml']) {
  test(`${name} validates source events without restarting checks on draft or ready changes`, () => {
    const triggers = read(name).on;
    assert.deepEqual(triggers.pull_request.types, ['opened', 'synchronize', 'reopened']);
    assert.equal(triggers.pull_request.branches, undefined);
    assert.deepEqual(triggers.push.branches, ['main']);
    for (const action of ['ready_for_review', 'converted_to_draft'])
      assert.equal(triggers.pull_request.types.includes(action), false, `${name}: ${action}`);
    // Static checks keep their manual entry; full iOS validation remains automatic only.
    assert.equal(Object.hasOwn(triggers, 'workflow_dispatch'), name !== 'e2e-test.yml');
  });
}

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
  const full = read('e2e-test.yml');
  assertAutomaticGraph('e2e-test.yml');
  assert.equal(full.jobs.plan['runs-on'], 'ubuntu-24.04');
  assert.equal(full.jobs.plan['continue-on-error'], undefined);
  assert.equal(full.jobs.production_validation.needs, 'plan');
  assert.equal(full.jobs.debug_products.needs, 'plan');
  assert.equal(full.jobs.oauth_products.needs, 'plan');
  assert.equal(full.jobs.oauth_execution.needs, 'oauth_products');
  assert.deepEqual(full.jobs.debug_execution.needs, ['plan', 'debug_products']);
  assert.equal(full.jobs.release_products.needs, 'plan');
  assert.deepEqual(full.jobs.release_execution.needs, ['plan', 'release_products']);
  assert.equal(full.on.workflow_dispatch, undefined);
  assert.equal(full.on.workflow_call, undefined);
});

test('focused diagnostics start automatically after Linux selection without a deployment environment', () => {
  const focus = read('ios-focused.yml');
  assertAutomaticGraph('e2e-selected.yml');
  assert.equal(focus.jobs.selection['runs-on'], 'ubuntu-24.04');
  assert.equal(focus.jobs.selection['continue-on-error'], undefined);
  assert.equal(focus.jobs.products.needs, 'selection');
});

test('draft PR updates and main pushes start full CI while manual diagnostics cannot satisfy it', () => {
  const e2e = read('e2e-test.yml');
  assert.ok(e2e.on.pull_request.types.includes('synchronize'));
  assert.deepEqual(e2e.on.push.branches, ['main']);
  assert.doesNotMatch(e2e.jobs.plan.if, /outputs\.deferred != 'true'/);
  assert.match(e2e.jobs.plan.if, /github\.event_name != 'workflow_dispatch'/);
  assert.equal(e2e.jobs.focused_scenario, undefined);
  // Selected iOS paths cannot bypass validation; completed exclusions do not need a full result.
  const condition =
    "needs.selection.outputs.run_ios == 'true' && needs.selection.outputs.deferred == 'true' && needs.completeness.result != 'success'";
  assert.ok(e2e.jobs.ios_simulator_build.steps[0].env.DEFERRED.includes(condition));
  assert.ok(e2e.jobs.required_statuses.with.invalid_selection.includes(condition));
  assert.ok(e2e.jobs.required_statuses.with.invalid_selection.includes("diagnostic == 'true'"));
});

// Evaluate only the comparison/boolean subset used by these trusted workflow
// guards; this is local composition proof, not a GitHub expression runtime.
function evaluateGuard(expression, context) {
  const source = expression
    .replace(/^\$\{\{\s*|\s*\}\}$/g, '')
    .replace(/(?:needs|github|steps)(?:\.[a-z_]+)+/g, (path) =>
      JSON.stringify(path.split('.').reduce((value, key) => value?.[key], context) ?? ''),
    );
  return Function(`"use strict"; return (${source});`)();
}

test('actual selection and workflow gates preserve draft exclusions and reject incomplete full validation', () => {
  const e2e = read('e2e-test.yml');
  const guard = e2e.jobs.ios_simulator_build.steps[0];
  const cases = [
    { name: 'docs draft', draft: true, paths: ['docs/development.md'], accepted: true },
    { name: 'docs ready', draft: false, paths: ['docs/development.md'], accepted: true },
    ...['failed', 'cancelled', 'skipped', ''].map((result) => ({
      name: `selected draft ${result || 'missing'}`,
      draft: true,
      paths: ['apps/mobile/src/App.tsx'],
      result,
      accepted: false,
    })),
    {
      name: 'selected full success',
      draft: true,
      paths: ['apps/mobile/src/App.tsx'],
      result: 'success',
      accepted: true,
    },
    { name: 'incomplete selection', draft: true, complete: 'false', accepted: false },
    { name: 'missing selection', draft: true, complete: '', accepted: false },
    { name: 'diagnostic selection', draft: true, diagnostic: 'true', accepted: false },
    {
      name: 'unsupported manual',
      draft: true,
      diagnostic: 'true',
      event: 'workflow_dispatch',
      accepted: false,
    },
  ];
  for (const scenario of cases) {
    const event = scenario.event ?? 'pull_request';
    const selected = selectChecksForPaths(scenario.paths ?? ['docs/development.md']);
    const context = {
      needs: {
        selection: {
          outputs: {
            complete: scenario.complete ?? 'true',
            deferred: String(
              resolveFullValidationDeferred(event, { pull_request: { draft: scenario.draft } }),
            ),
            diagnostic: scenario.diagnostic ?? 'false',
            ios_build: String(selected.ios_build),
            ios_tests: String(selected.ios_tests),
          },
        },
        completeness: { result: scenario.result ?? 'skipped' },
      },
      github: { event_name: event },
    };
    const outputs = context.needs.selection.outputs;
    context.steps = {
      select: {
        outputs: {
          selection_complete: outputs.complete,
          ios_build: outputs.ios_build,
          ios_tests: outputs.ios_tests,
        },
      },
    };
    outputs.run_ios = String(evaluateGuard(e2e.jobs.selection.outputs.run_ios, context));
    assert.equal(
      outputs.run_ios,
      String(outputs.complete !== 'true' || selected.ios_build || selected.ios_tests),
      scenario.name,
    );
    const env = Object.fromEntries(
      Object.entries(guard.env).map(([key, value]) => [key, String(evaluateGuard(value, context))]),
    );
    // Run the actual Build shell guard, alongside the five-domain caller gate.
    const build = spawnSync('bash', ['-c', guard.run], { env, encoding: 'utf8' });
    assert.equal(build.status === 0, scenario.accepted, `${scenario.name}: Build`);
    const invalid = evaluateGuard(e2e.jobs.required_statuses.with.invalid_selection, context);
    assert.equal(!invalid, scenario.accepted, `${scenario.name}: domains`);
    const domainGuard = read('ios-required-statuses.yml').jobs.status.steps[0];
    const domain = spawnSync('bash', ['-c', domainGuard.run], {
      env: { INVALID: String(invalid) },
    });
    assert.equal(domain.status === 0, scenario.accepted, `${scenario.name}: domain shell`);
  }
});
