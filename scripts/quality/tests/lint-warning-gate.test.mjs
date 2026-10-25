import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const lintSource = readFileSync(resolve(root, 'scripts/quality/lint.mjs'), 'utf8');
const eslint = resolve(root, 'node_modules/eslint/bin/eslint.js');

function runEslint(source) {
  return spawnSync(
    process.execPath,
    [
      eslint,
      '--no-eslintrc',
      '--no-ignore',
      '--config',
      resolve(root, 'scripts/quality/eslint.config.cjs'),
      '--rule',
      'no-warning-comments:warn',
      '--max-warnings',
      '0',
      '--stdin',
      '--stdin-filename',
      'lint-warning-gate-probe.js',
    ],
    { cwd: root, encoding: 'utf8', input: source },
  );
}

test('both quality-runner ESLint surfaces set a zero-warning threshold', () => {
  assert.equal((lintSource.match(/'--max-warnings'\s*,\s*'0'/g) ?? []).length, 2);
});

test('the ESLint zero-warning threshold fails on a warning and accepts clean input', () => {
  const warning = runEslint('// TODO: warning gate probe\n');
  assert.equal(warning.status, 1, warning.stderr);
  assert.match(`${warning.stdout}${warning.stderr}`, /ESLint found too many warnings/);

  const clean = runEslint('');
  assert.equal(clean.status, 0, `${clean.stdout}${clean.stderr}`);
});
