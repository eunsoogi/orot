import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('eslint/package.json'))('js-yaml');

test('daily main schedule is the only E2E workflow trigger', () => {
  const workflow = yaml.load(readFileSync('.github/workflows/e2e-test.yml', 'utf8'));
  assert.deepEqual(Object.keys(workflow.on), ['schedule']);
  assert.deepEqual(workflow.on.schedule, [{ cron: '0 18 * * *' }]);
});
