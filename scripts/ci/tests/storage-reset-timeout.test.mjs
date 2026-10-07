import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const storageTestPath = path.join(repositoryRoot, 'apps/mobile/e2e/storage.test.js');
const detoxJestConfigPath = path.join(repositoryRoot, 'apps/mobile/e2e/jest.config.js');
const require = createRequire(import.meta.url);
const { createStorageResetGuard, failureMessage, installFreshApp } = require(
  path.join(repositoryRoot, 'apps/mobile/e2e/storageProbeResetGuard.e2e.js'),
);

async function registerStorageCases() {
  const source = await readFile(storageTestPath, 'utf8');
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
    require(modulePath) {
      assert.equal(modulePath, './storageProbeResetGuard.e2e.js');
      return { createStorageResetGuard: () => ({}), installFreshApp: async () => {} };
    },
  };

  // Register the real Jest cases without running Detox commands on this host.
  vm.runInNewContext(source, sandbox, { filename: storageTestPath });
  return { cases, source };
}

test('only fresh-reset storage cases receive the four-minute Jest deadline', async () => {
  const { cases, source } = await registerStorageCases();
  const detoxJestConfig = await readFile(detoxJestConfigPath, 'utf8');
  const freshResetCases = cases.filter(({ name }) => name.includes('fresh install'));
  const restartCase = cases.find(({ name }) => name.includes('process restart'));
  const restartCaseStart = source.indexOf(
    "it('reopens a source and its evidence span after an app process restart'",
  );
  const migrationCaseStart = source.indexOf(
    "it(\n    'migrates the earlier test schema on fresh install'",
  );
  const restartCaseSource = source.slice(restartCaseStart, migrationCaseStart);

  assert.deepEqual(
    freshResetCases.map(({ timeout }) => timeout),
    [240000, 240000],
  );
  assert.equal(restartCase.timeout, undefined);
  assert.match(detoxJestConfig, /testTimeout:\s*120000/);
  assert.match(
    source,
    /it\(\s*'creates encrypted source and evidence records on fresh install'[\s\S]*?await installFreshApp\(device, resetGuard\);[\s\S]*?await expectProbeSuccess\('fresh'\);/,
  );
  assert.match(
    source,
    /it\('reopens a source and its evidence span after an app process restart',[\s\S]*?await expectProbeSuccess\('fresh'\);[\s\S]*?await device\.terminateApp\(\);[\s\S]*?await expectProbeSuccess\('restart'\);/,
  );
  assert.doesNotMatch(restartCaseSource, /installFreshApp/);
  assert.match(
    source,
    /it\([\s\S]*?'migrates the earlier test schema on fresh install'[\s\S]*?await installFreshApp\(device, resetGuard\);[\s\S]*?await expectProbeSuccess\('legacy'\);/,
  );
  assert.match(source, /async function expectProbeSuccess\(mode\)[\s\S]*?withTimeout\(30000\)/);
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
