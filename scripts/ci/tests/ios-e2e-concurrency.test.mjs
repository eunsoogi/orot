import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('eslint/package.json'))('js-yaml');
const workflow = yaml.load(readFileSync('.github/workflows/e2e-test.yml', 'utf8'));
const diagnostic = yaml.load(readFileSync('.github/workflows/e2e-selected.yml', 'utf8'));

function evaluate(expression, context) {
  const source = expression.replace(/(?:github|steps)(?:\.[a-z_]+)+/g, (path) => {
    const value = path.split('.').reduce((current, key) => current?.[key], context);
    return typeof value === 'boolean' ? String(value) : JSON.stringify(value ?? '');
  });
  return Function(`"use strict"; return (${source});`)();
}

function groupFor(action) {
  const context = {
    github: {
      repository: 'eunsoogi/orot',
      event_name: 'pull_request',
      event: { action, pull_request: { number: 205 } },
    },
  };
  return workflow.concurrency.group.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_match, expression) =>
    String(evaluate(expression, context)),
  );
}

test('ready runs and explicit diagnostics share a queue that retains pending validations', () => {
  const sharedGroup = groupFor('synchronize');
  for (const action of ['opened', 'reopened', 'ready_for_review', 'edited', 'converted_to_draft'])
    assert.equal(groupFor(action), sharedGroup);
  assert.equal(workflow.concurrency.group, diagnostic.concurrency.group);
  assert.equal(workflow.concurrency.queue, 'max');
  assert.equal(diagnostic.concurrency.queue, 'max');
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.equal(diagnostic.concurrency['cancel-in-progress'], false);
});
