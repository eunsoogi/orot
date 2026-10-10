import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const resetGuardModule = createRequire(join(repositoryRoot, 'package.json'))(
  './apps/mobile/e2e/storageProbeResetGuard.e2e.js',
);
const mobileRequire = createRequire(join(repositoryRoot, 'apps/mobile/package.json'));
// Resolve from Jest so pnpm can find its private jest-circus dependency.
const jestRequire = createRequire(mobileRequire.resolve('jest/package.json'));
const circusDirectory = dirname(jestRequire.resolve('jest-circus'));

test('a timed-out phase cannot overlap a sibling reset or finish a late install', () => {
  assert.equal(resetGuardModule.resetTimeoutMs, 240000);
  assert.equal(resetGuardModule.resetHookTimeoutMs, 241000);

  // Use real Jest Circus hook ordering with deferred Detox calls, but shorten its hook deadline.
  const script = String.raw`
    const fs = require('node:fs');
    const path = require('node:path');
    const vm = require('node:vm');
    const root = ${JSON.stringify(repositoryRoot)};
    const circusDirectory = ${JSON.stringify(circusDirectory)};
    const requireFromRepository = require('node:module').createRequire(path.join(root, 'package.json'));
    const circus = require(path.join(circusDirectory, 'index.js'));
    const { getState } = require(path.join(circusDirectory, 'state.js'));
    const run = require(path.join(circusDirectory, 'run.js')).default;
    const wrappers = requireFromRepository('./apps/mobile/e2e/release-e2e-shards.js');
    const resetGuard = requireFromRepository('./apps/mobile/e2e/storageProbeResetGuard.e2e.js')
      .createStorageResetGuard({ timeoutMs: 20 });
    const calls = [];
    const hookTimeouts = [];
    let clearCount = 0;
    let releaseFirstClear;
    getState().testTimeout = 1000;
    function loadReleaseWrapper(wrapperName) {
      vm.runInNewContext(fs.readFileSync(path.join(root, 'apps/mobile/e2e', wrapperName), 'utf8'), {
        beforeAll(hook, timeout) {
          hookTimeouts.push(timeout ?? null);
          circus.beforeAll(hook, 80);
        },
        describe: circus.describe,
        device: {
          async clearKeychain() {
            clearCount += 1;
            calls.push('clear-start-' + clearCount);
            if (clearCount === 1) {
              await new Promise((resolve) => {
                releaseFirstClear = resolve;
              });
            }
            calls.push('clear-end-' + clearCount);
          },
          async installApp() {
            calls.push('install');
          },
          async uninstallApp() {
            calls.push('uninstall');
          },
        },
        process: { env: { OROT_DETOX_RELEASE_FRESH_SIMULATOR: 'true' } },
        require(specifier) {
          if (specifier === './release-e2e-shards.js') return wrappers;
          if (specifier === './storageProbeResetGuard.e2e.js') {
            return { releasePhaseResetGuard: resetGuard, resetHookTimeoutMs: 241000 };
          }
          if (specifier === './release-e2e-data.test.js') {
            // Load nested phase hooks into the same Circus tree to test reset serialization end to end.
            loadReleaseWrapper('release-e2e-data.test.js');
            return {};
          }
          circus.it(specifier, async () => {
            calls.push('body-' + specifier);
            if (specifier === './storage-migration.test.js') {
              releaseFirstClear?.();
              await new Promise((resolve) => setImmediate(resolve));
            }
          });
        },
      });
    }

    loadReleaseWrapper('release-e2e.test.js');
    run().then(async (result) => {
      releaseFirstClear?.();
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      process.stdout.write(JSON.stringify({
        calls,
        hookTimeouts,
        failedFiles: result.testResults.filter((file) => file.errors.length > 0).length,
      }));
    }).catch((error) => {
      process.stderr.write(String(error.stack || error));
      process.exitCode = 1;
    });
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: 6000,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const observation = JSON.parse(result.stdout);
  assert.deepEqual(
    { calls: observation.calls, hookTimeouts: observation.hookTimeouts },
    { calls: ['clear-start-1', 'clear-end-1'], hookTimeouts: [241000, 241000, 241000] },
    JSON.stringify(observation),
  );
  assert.ok(observation.failedFiles > 0);
});
