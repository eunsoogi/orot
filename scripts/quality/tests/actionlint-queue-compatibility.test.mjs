import assert from 'node:assert/strict';
import test from 'node:test';
import { actionlintInvocationArgs } from '../lint.mjs';

test('all workflows remain actionlint-checked while only queued E2E files use the compatibility diagnostic', () => {
  const paths = [
    '.github/workflows/ci.yml',
    '.github/workflows/e2e-test.yml',
    '.github/workflows/e2e-selected.yml',
  ];
  const invocations = actionlintInvocationArgs(paths);

  assert.deepEqual(invocations, [
    ['.github/workflows/ci.yml'],
    [
      '-ignore',
      'unexpected key "queue" for "concurrency" section',
      '.github/workflows/e2e-test.yml',
      '.github/workflows/e2e-selected.yml',
    ],
  ]);
  const checkedPaths = invocations.flatMap((args) =>
    args.filter((arg) => arg.startsWith('.github/workflows/')),
  );
  assert.deepEqual(checkedPaths.sort(), paths.sort());
});
