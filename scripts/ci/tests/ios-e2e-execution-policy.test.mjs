import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('eslint/package.json'))('js-yaml');
const read = (name) => yaml.load(readFileSync('.github/workflows/' + name, 'utf8'));

// This evaluates only the simple GitHub expressions used to gate nightly Mac work.
function evaluate(expression, context) {
  const source = expression
    .replace(/^\$\{\{\s*|\s*\}\}$/g, '')
    .replace(/(?:github|steps)(?:\.[a-z_]+)+/g, (path) => {
      const value = path.split('.').reduce((current, key) => current?.[key], context);
      return JSON.stringify(value ?? '');
    });
  return Function('"use strict"; return (' + source + ');')();
}

test('only the successful Full run on the main nightly schedule can allocate Mac work', () => {
  const e2e = read('e2e-test.yml');

  assert.deepEqual(Object.keys(e2e.on), ['schedule']);
  assert.deepEqual(e2e.on.schedule, [{ cron: '0 18 * * *' }]);
  const selectionCheckout = e2e.jobs.selection.steps.find((step) =>
    step.uses?.startsWith('actions/checkout@'),
  );
  // Nightly Full bypasses ref comparison, so its selector needs only the scheduled commit.
  assert.equal(selectionCheckout?.with?.['fetch-depth'], 1);
  assert.equal(e2e.jobs.selection.outputs.diagnostic, false);
  assert.equal(e2e.jobs.selection.outputs.non_protected_contexts, false);
  assert.equal(e2e.jobs.ios_simulator_build.name, 'Validate / Build');
  assert.equal(e2e.jobs.required_statuses.name, 'Validate');

  const runMac = e2e.jobs.selection.outputs.run_ios;
  const scenarios = [
    {
      label: 'successful Full schedule on main',
      eventName: 'schedule',
      ref: 'refs/heads/main',
      tier: 'full',
      complete: 'true',
      outcome: 'success',
      expected: true,
    },
    { label: 'pull request event', eventName: 'pull_request', expected: false },
    { label: 'main push', eventName: 'push', ref: 'refs/heads/main', expected: false },
    {
      label: 'manual dispatch on main',
      eventName: 'workflow_dispatch',
      ref: 'refs/heads/main',
      tier: 'full',
      complete: 'true',
      outcome: 'success',
      expected: false,
    },
    {
      label: 'schedule on a non-main ref',
      eventName: 'schedule',
      ref: 'refs/heads/feature',
      tier: 'full',
      complete: 'true',
      outcome: 'success',
      expected: false,
    },
    {
      label: 'incomplete selection',
      eventName: 'schedule',
      ref: 'refs/heads/main',
      tier: 'full',
      complete: 'false',
      outcome: 'success',
      expected: false,
    },
    {
      label: 'selector failure',
      eventName: 'schedule',
      ref: 'refs/heads/main',
      tier: 'full',
      complete: 'true',
      outcome: 'failure',
      expected: false,
    },
    {
      label: 'non-Full selection',
      eventName: 'schedule',
      ref: 'refs/heads/main',
      tier: 'diagnostic',
      complete: 'true',
      outcome: 'success',
      expected: false,
    },
  ];

  for (const scenario of scenarios) {
    const context = {
      github: {
        event_name: scenario.eventName,
        ref: scenario.ref ?? 'refs/pull/217/merge',
        event: { pull_request: { draft: false } },
      },
      steps: {
        select: {
          outcome: scenario.outcome ?? 'success',
          outputs: {
            validation_tier: scenario.tier ?? 'full',
            selection_complete: scenario.complete ?? 'true',
            metadata_only_edit: 'false',
            ios_build: 'true',
            ios_tests: 'true',
          },
        },
      },
    };

    assert.equal(evaluate(runMac, context), scenario.expected, scenario.label);
  }
});
