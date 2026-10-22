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
const readText = (path) => readFileSync(path, 'utf8');

// This evaluates only the trusted workflow expressions used to compose runner guards.
function evaluateGuard(expression, context) {
  const source = expression
    .replace(/^\$\{\{\s*|\s*\}\}$/g, '')
    .replace(/(?:inputs|needs|github|steps)(?:\.[a-z_]+)+/g, (path) => {
      const value = path.split('.').reduce((current, key) => current?.[key], context);
      return JSON.stringify(value ?? '');
    });
  return Function('"use strict"; return (' + source + ');')();
}

function resolveActionInputs(expression, inputs) {
  // The composite receipt action exposes only caller-provided inputs to its shell guard.
  return String(expression).replace(/\$\{\{\s*inputs\.([a-z_]+)\s*\}\}/g, (_, key) =>
    String(inputs[key] ?? ''),
  );
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
      ready('ready source ' + (result || 'missing') + ' result', {
        result,
        domainAccepted: false,
      }),
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
  const receiptStep = e2e.jobs.ios_simulator_build.steps.find(
    ({ uses }) => uses === './.github/actions/ios-e2e-validation-receipt',
  );
  const receiptAction = yaml.load(
    readText('.github/actions/ios-e2e-validation-receipt/action.yml'),
  );
  const buildGuard = receiptAction.runs.steps[0];
  assert.equal(receiptStep.uses, './.github/actions/ios-e2e-validation-receipt');

  for (const scenario of cases) {
    const selected = selectChecksForPaths(scenario.paths ?? ['apps/mobile/src/App.tsx']);
    const metadataOnlyEdit = scenario.metadataOnlyEdit === true;
    const event = {
      action: scenario.action,
      pull_request: { draft: scenario.draft },
    };
    const validationTier =
      scenario.event === 'workflow_dispatch'
        ? scenario.ref === 'refs/heads/main'
          ? 'full'
          : 'diagnostic'
        : scenario.event === 'push'
          ? 'main-impact'
          : 'pr';
    const outputs = {
      complete: scenario.complete ?? 'true',
      deferred: String(resolveFullValidationDeferred(scenario.event, event)),
      diagnostic: scenario.diagnostic ?? 'false',
      selection_complete: scenario.complete ?? 'true',
      validation_tier: validationTier,
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
      inputs: { candidate_pr_number: scenario.candidatePrNumber ?? '' },
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
      steps: {
        select: {
          outcome: 'success',
          outputs,
        },
      },
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
    assert.equal(runIos, expectedRunIos, scenario.name + ': native allocation');

    const receiptInputs = Object.fromEntries(
      Object.entries(receiptStep.with).map(([key, value]) => [
        key,
        String(evaluateGuard(value, context)),
      ]),
    );
    const buildEnv = Object.fromEntries(
      Object.entries(buildGuard.env).map(([key, value]) => [
        key,
        resolveActionInputs(value, receiptInputs),
      ]),
    );
    const build = spawnSync('/bin/bash', ['-c', buildGuard.run], {
      env: buildEnv,
      encoding: 'utf8',
    });
    assert.equal(build.status === 0, scenario.accepted, scenario.name + ': Build status');

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
      scenario.name + ': UI domain status (' + domain.stderr + ')',
    );
  }
});
