import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('eslint/package.json'))('js-yaml');
const workflow = yaml.load(readFileSync('.github/workflows/e2e-test.yml', 'utf8'));

test('Full validation retains the shared Mac queue and never cancels an active run', () => {
  assert.equal(workflow.concurrency.group, 'ios-ci-macos-${{ github.repository }}');
  assert.equal(workflow.concurrency.queue, 'max');
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
});
