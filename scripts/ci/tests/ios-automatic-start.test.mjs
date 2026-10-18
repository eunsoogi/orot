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
test('full E2E listens to ready PR events, main pushes and release dispatch', () => {
  const e2e = read('e2e-test.yml');
  assert.deepEqual(e2e.on.pull_request.types, [
    'opened',
    'synchronize',
    'reopened',
    'ready_for_review',
    'converted_to_draft',
    'edited',
  ]);
  assert.equal(e2e.on.pull_request.branches, undefined);
  assert.deepEqual(e2e.on.push, { branches: ['main'] });
  assert.deepEqual(e2e.on.workflow_dispatch, {});
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

test('focused diagnostics remain a separate automatic manual workflow without deployment approval', () => {
  const focus = read('ios-focused.yml');
  assertAutomaticGraph('e2e-selected.yml');
  assert.equal(focus.jobs.selection['runs-on'], 'ubuntu-24.04');
  assert.equal(focus.jobs.selection['continue-on-error'], undefined);
  assert.equal(focus.jobs.products.needs, 'selection');
});

// Evaluate the comparison/boolean subset used by these trusted workflow guards;
// this is local composition proof, not a GitHub expression runtime.
function evaluateGuard(expression, context) {
  const source = expression
    .replace(/^\$\{\{\s*|\s*\}\}$/g, '')
    .replace(/(?:needs|github|steps)(?:\.[a-z_]+)+/g, (path) =>
      JSON.stringify(path.split('.').reduce((value, key) => value?.[key], context) ?? ''),
    );
  return Function(`"use strict"; return (${source});`)();
}

test('ready events select current-head work while drafts and metadata edits never allocate Mac jobs', () => {
  const e2e = read('e2e-test.yml');
  const selection = e2e.jobs.selection;
  const ready = (name, overrides = {}) => ({
    name,
    event: 'pull_request',
    draft: false,
    paths: ['apps/mobile/src/App.tsx'],
    accepted: true,
    domainAccepted: true,
    ...overrides,
  });
  const cases = [
    ready('draft source edit', { draft: true }),
    ready('main push with impacted E2E changes', {
      event: 'push',
      ref: 'refs/heads/main',
      result: 'success',
    }),
    ready('main documentation push', {
      event: 'push',
      ref: 'refs/heads/main',
      paths: ['docs/development.md'],
    }),
    ready('ready source success', { result: 'success' }),
    ...['failure', 'cancelled', 'skipped', ''].map((result) =>
      ready(`ready source ${result || 'missing'} result`, { result, domainAccepted: false }),
    ),
    ready('metadata-only edit with reusable same-head ready evidence', {
      action: 'edited',
      metadataOnlyEdit: true,
      reuseResult: 'success',
      reusedCohorts: ['core-ui'],
    }),
    ready('metadata-only edit without reusable ready evidence', {
      action: 'edited',
      metadataOnlyEdit: true,
      reuseResult: 'failure',
      reusedCohorts: [],
      accepted: false,
      domainAccepted: false,
    }),
    ready('ready docs change', { paths: ['docs/development.md'] }),
    ready('incomplete selector output', {
      complete: 'false',
      accepted: false,
      domainAccepted: false,
    }),
    {
      name: 'unsupported manual dispatch outside main',
      event: 'workflow_dispatch',
      ref: 'refs/heads/feature',
      draft: false,
      diagnostic: 'true',
      accepted: false,
      domainAccepted: false,
    },
  ];

  const statusWorkflow = read('ios-required-statuses.yml');
  const ui = statusWorkflow.jobs.status.strategy.matrix.include.find(
    (entry) => entry.check === 'UI',
  );
  const domainGuard = statusWorkflow.jobs.status.steps[0];
  for (const scenario of cases) {
    const selected = selectChecksForPaths(scenario.paths ?? ['apps/mobile/src/App.tsx']);
    const metadataOnlyEdit = scenario.metadataOnlyEdit === true;
    const event = {
      action: scenario.action,
      pull_request: { draft: scenario.draft },
    };
    const outputs = {
      complete: scenario.complete ?? 'true',
      deferred: String(resolveFullValidationDeferred(scenario.event, event)),
      diagnostic: scenario.diagnostic ?? 'false',
      selection_complete: scenario.complete ?? 'true',
      full_validation_deferred: String(resolveFullValidationDeferred(scenario.event, event)),
      metadata_only_edit: String(metadataOnlyEdit),
      ios_build: String(selected.ios_build),
      ios_tests: String(selected.ios_tests),
      ios_test_cohorts: JSON.stringify(selected.ios_test_cohorts),
    };
    const context = {
      github: {
        event_name: scenario.event,
        ref: scenario.ref ?? 'refs/pull/203/merge',
        event,
      },
      needs: {
        completeness: { result: scenario.result ?? 'skipped' },
        reuse_ready_evidence: {
          result: scenario.reuseResult ?? 'skipped',
          outputs: {
            selected_cohorts: JSON.stringify(scenario.reusedCohorts ?? []),
            oauth_required: 'false',
          },
        },
      },
      steps: { select: { outputs } },
    };
    outputs.run_ios = String(evaluateGuard(selection.outputs.run_ios, context));
    outputs.non_protected_contexts = String(
      evaluateGuard(selection.outputs.non_protected_contexts, context),
    );
    context.needs.selection = { outputs };

    const runIos = outputs.run_ios === 'true';
    const expectedRunIos =
      !(scenario.event === 'pull_request' && scenario.draft) &&
      !(scenario.event === 'workflow_dispatch' && scenario.ref !== 'refs/heads/main') &&
      !metadataOnlyEdit &&
      (outputs.complete !== 'true' || selected.ios_build || selected.ios_tests);
    assert.equal(runIos, expectedRunIos, `${scenario.name}: native allocation`);

    const buildGuard = e2e.jobs.ios_simulator_build.steps[0];
    const buildEnv = Object.fromEntries(
      Object.entries(buildGuard.env).map(([key, value]) => [
        key,
        String(evaluateGuard(value, context)),
      ]),
    );
    const build = spawnSync('/bin/bash', ['-c', buildGuard.run], {
      env: buildEnv,
      encoding: 'utf8',
    });
    assert.equal(build.status === 0, scenario.accepted, `${scenario.name}: Build status`);

    const statusInputs = Object.fromEntries(
      Object.entries(e2e.jobs.required_statuses.with).map(([key, value]) => [
        key,
        evaluateGuard(value, context),
      ]),
    );
    const statusEnv = {
      INVALID: String(statusInputs.invalid_selection),
      NON_PROTECTED_CONTEXTS: String(statusInputs.non_protected_contexts),
      METADATA_ONLY_EDIT: String(statusInputs.metadata_only_edit),
      REUSE_RESULT: statusInputs.reuse_result,
      SELECTED: String(statusInputs.selected),
      SELECTED_COHORTS: statusInputs.selected_cohorts,
      CHECK_COHORTS: ui.cohorts,
      EXECUTION_RESULT: statusInputs.execution_result,
      CHECK_NAME: 'UI',
    };
    const domain = spawnSync('/bin/bash', ['-c', domainGuard.run], {
      env: statusEnv,
      encoding: 'utf8',
    });
    assert.equal(
      domain.status === 0,
      scenario.domainAccepted,
      `${scenario.name}: UI domain status (${domain.stderr})`,
    );
  }
});
