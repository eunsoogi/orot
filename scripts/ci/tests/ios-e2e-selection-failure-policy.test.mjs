import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('eslint/package.json'))('js-yaml');
const workflow = yaml.load(readFileSync('.github/workflows/e2e-test.yml', 'utf8'));

function evaluate(expression, context) {
  const source = expression
    .replace(/^\$\{\{\s*|\s*\}\}$/g, '')
    .replace(/(?:github|inputs|needs|steps)(?:\.[a-z_]+)+/g, (path) => {
      const value = path.split('.').reduce((current, key) => current?.[key], context);
      return typeof value === 'boolean' ? String(value) : JSON.stringify(value ?? '');
    });
  return Function(`"use strict"; return (${source});`)();
}

test('failed off-main manual selection keeps diagnostic status names', () => {
  const context = {
    github: { event_name: 'workflow_dispatch', ref: 'refs/heads/feature' },
    inputs: { candidate_pr_number: '' },
    steps: { select: { outcome: 'failure', outputs: { validation_tier: '' } } },
  };
  const diagnostic = evaluate(workflow.jobs.selection.outputs.diagnostic, context);
  const nonProtected = evaluate(workflow.jobs.selection.outputs.non_protected_contexts, context);
  const namedContext = {
    ...context,
    needs: { selection: { outputs: { non_protected_contexts: String(nonProtected) } } },
  };

  assert.equal(diagnostic, true);
  assert.equal(nonProtected, true);
  assert.equal(evaluate(workflow.jobs.ios_simulator_build.name, namedContext), 'Deferred / Build');
  assert.equal(evaluate(workflow.jobs.required_statuses.name, namedContext), 'Deferred');
});
