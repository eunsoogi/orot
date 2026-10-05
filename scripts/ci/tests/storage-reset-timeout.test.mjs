import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const storageTestPath = path.join(repositoryRoot, 'apps/mobile/e2e/storage.test.js');

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
      return { createStorageResetGuard: () => ({}) };
    },
  };

  // Register the real Jest cases without running Detox commands on this host.
  vm.runInNewContext(source, sandbox, { filename: storageTestPath });
  return { cases, source };
}

test('only fresh-reset storage cases override the two-minute Jest deadline', async () => {
  const { cases, source } = await registerStorageCases();
  const freshResetCases = cases.filter(({ name }) => name.includes('fresh install'));
  const restartCase = cases.find(({ name }) => name.includes('process restart'));

  assert.deepEqual(
    freshResetCases.map(({ timeout }) => timeout),
    [240000, 240000],
  );
  assert.equal(restartCase.timeout, undefined);
  assert.match(source, /async function expectProbeSuccess\(mode\)[\s\S]*?withTimeout\(30000\)/);
});
