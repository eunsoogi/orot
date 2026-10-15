import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { expandedActionSteps, workflow } from './fixtures/ios-workflow.mjs';

test('execution jobs consume compiled products without reinstalling build dependencies', () => {
  const executions = [
    ...Object.values(workflow('.github/workflows/ios-debug-tests.yml').jobs),
    ...Object.values(workflow('.github/workflows/ios-release-tests.yml').jobs),
    workflow('.github/workflows/ios-focused.yml').jobs.execution,
    workflow('.github/workflows/ios-oauth-execution.yml').jobs.execution,
  ];
  for (const execution of executions) {
    const steps = execution.steps.flatMap((step) =>
      step.uses?.startsWith('./.github/actions/')
        ? expandedActionSteps(step.uses + '/action.yml')
        : [step],
    );
    assert.doesNotMatch(
      JSON.stringify(steps),
      /pnpm|ios-native-toolchain|ios-platform-dependencies/,
    );
    assert.ok(steps.some((step) => step.uses?.startsWith('actions/setup-node@')));
    assert.ok(steps.some((step) => step.uses?.startsWith('actions/download-artifact@')));
  }
});

test('every native executor driver loads its local dependency closure in a checkout with no node_modules', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'orot-executor-dependencies-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync('scripts/ci', join(root, 'scripts/ci'), {
    recursive: true,
    filter: (path) => !path.includes('/tests'),
  });
  mkdirSync(join(root, 'apps/mobile/e2e'), { recursive: true });
  cpSync(
    'apps/mobile/e2e/backupContainerSnapshot.js',
    join(root, 'apps/mobile/e2e/backupContainerSnapshot.js'),
  );
  assert.equal(existsSync(join(root, 'node_modules')), false);
  const entries = [
    'ios-test-products',
    'run-ios-test-cohort',
    'run-ios-tests',
    'run-ios-fixture-tests',
    'run-ios-backup-tests',
    'run-ios-local-model-tests',
    'run-ios-speech-journey-tests',
    'run-ios-fixture-isolation-tests',
    'run-ios-recording-persistence-tests',
    'run-ios-state-persistence-tests',
    'run-ios-shared-persistence-tests',
    'oauth-test-products',
  ];
  for (const entry of entries) {
    // Missing execution arguments deliberately stop before any Apple operation. Module loading itself must succeed without installed packages.
    const result = spawnSync(process.execPath, ['scripts/ci/' + entry + '.mjs'], {
      cwd: root,
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
    });
    assert.equal(result.status, 1, entry);
    assert.match(result.stderr, /Usage:|requires? /, entry);
    assert.doesNotMatch(
      result.stderr,
      /MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|Cannot find package/,
      entry,
    );
  }
});
