import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { selectChecksForPaths } from '../changed-paths-select.mjs';

test('vendor and each native host harness surface select required unit execution', () => {
  for (const path of [
    'vendor/patches/@op-engineering__op-sqlite@18.2.5.patch',
    'scripts/native-cache/cacheSafety.test.cpp',
    'scripts/native-cache/cacheAllocation.test.cpp',
    'scripts/native-cache/cacheFailure.test.cpp',
    'scripts/native-cache/cacheDriver.test.cpp',
    'scripts/native-cache/run-tests.sh',
  ]) {
    const selected = selectChecksForPaths([path]);
    assert.equal(selected.unit_tests, true, path);
    assert.equal(selected.policy_tests, true, path);
  }
});

test('required unit job executes installed native source and fails without its runner', () => {
  const workflow = readFileSync('.github/workflows/unit-test.yml', 'utf8');
  assert.match(
    workflow,
    /- name: Run installed native cache host regressions\n\s+run: scripts\/ci\/run-command\.sh native-cache artifacts\/unit\/native-cache\.log -- bash scripts\/native-cache\/run-tests\.sh/,
  );
  const runner = readFileSync('scripts/native-cache/run-tests.sh', 'utf8');
  assert.match(runner, /set -euo pipefail/);
  assert.match(runner, /for suite in Safety Failure Allocation/);
  assert.match(runner, /cacheDriver\.test\.cpp/);
  assert.match(runner, /\$package\/cpp\/OrotCachedExecute\.cpp/);
  assert.doesNotMatch(runner, /continue-on-error|\|\| true/);
});

test('native patch retains valid unified-diff file prefixes including newly added sources', () => {
  const patch = readFileSync('vendor/patches/@op-engineering__op-sqlite@18.2.5.patch', 'utf8');
  const headers = patch.split('\n').filter((line) => line.startsWith('diff --git '));
  assert.ok(headers.length >= 7);
  for (const header of headers) assert.match(header, /^diff --git a\/(\S+) b\/\1$/);
});
