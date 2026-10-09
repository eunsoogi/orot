import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const storageTestPath = path.join(repositoryRoot, 'apps/mobile/e2e/storage.test.js');
const migrationTestPath = path.join(repositoryRoot, 'apps/mobile/e2e/storage-migration.test.js');
const detoxJestConfigPath = path.join(repositoryRoot, 'apps/mobile/e2e/jest.config.js');
const require = createRequire(import.meta.url);
const { createStorageResetGuard, failureMessage, installFreshApp } = require(
  path.join(repositoryRoot, 'apps/mobile/e2e/storageProbeResetGuard.e2e.js'),
);

async function registerCases(testPath) {
  const source = await readFile(testPath, 'utf8');
  const cases = [];
  const sandbox = {
    afterEach() {},
    beforeEach() {},
    describe(_name, defineCases) {
      defineCases();
    },
    it(name, body, timeout) {
      cases.push({ name, body, timeout });
    },
  };

  // Register the real Jest cases without running Detox commands on this host.
  vm.runInNewContext(source, sandbox, { filename: testPath });
  return { cases, source };
}

test('first storage and migration launches keep bounded timeouts while process restart uses the suite default', async () => {
  const { cases: storageCases } = await registerCases(storageTestPath);
  const { cases: migrationCases } = await registerCases(migrationTestPath);
  const detoxJestConfig = await readFile(detoxJestConfigPath, 'utf8');
  const freshProbe = storageCases.find(({ name }) => name.includes('fresh install'));
  const restartCase = storageCases.find(({ name }) => name.includes('process restart'));
  const migrationCase = migrationCases.find(({ name }) => name.includes('fresh install'));

  assert.equal(freshProbe.timeout, 240000);
  assert.equal(restartCase.timeout, undefined);
  assert.equal(migrationCase.timeout, 240000);
  assert.match(detoxJestConfig, /testTimeout:\s*120000/);
});

test('a reset left in flight at teardown blocks remaining and later Simulator commands', async () => {
  let finishUninstall;
  const uninstallPending = new Promise((resolve) => {
    finishUninstall = resolve;
  });
  const commands = [];
  const device = {
    uninstallApp() {
      commands.push('uninstall');
      return uninstallPending;
    },
    clearKeychain() {
      commands.push('clearKeychain');
    },
    installApp() {
      commands.push('install');
    },
  };
  const resetGuard = createStorageResetGuard();

  const delayedReset = installFreshApp(device, resetGuard);
  resetGuard.afterTest();
  finishUninstall();

  await assert.rejects(delayedReset, { message: failureMessage });
  await assert.rejects(installFreshApp(device, resetGuard), { message: failureMessage });
  assert.deepEqual(commands, ['uninstall']);
});
