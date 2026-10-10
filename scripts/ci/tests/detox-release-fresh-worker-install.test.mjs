import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { runSmokeSetup } from './release-e2e-test-support.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const requireFromRepository = createRequire(join(repositoryRoot, 'package.json'));

function loadDetoxConfig({ freshSimulator = false, releaseSharding = false } = {}) {
  const previousFreshSimulator = process.env.OROT_DETOX_RELEASE_FRESH_SIMULATOR;
  const previousSharding = process.env.OROT_DETOX_RELEASE_SHARDING;
  const configPath = './apps/mobile/.detoxrc.js';
  const resolvedConfigPath = requireFromRepository.resolve(configPath);
  const cachedConfig = requireFromRepository.cache[resolvedConfigPath];
  if (freshSimulator) process.env.OROT_DETOX_RELEASE_FRESH_SIMULATOR = 'true';
  else delete process.env.OROT_DETOX_RELEASE_FRESH_SIMULATOR;
  if (releaseSharding) process.env.OROT_DETOX_RELEASE_SHARDING = 'true';
  else delete process.env.OROT_DETOX_RELEASE_SHARDING;
  delete requireFromRepository.cache[resolvedConfigPath];
  try {
    return requireFromRepository(configPath);
  } finally {
    if (cachedConfig) requireFromRepository.cache[resolvedConfigPath] = cachedConfig;
    else delete requireFromRepository.cache[resolvedConfigPath];
    if (previousFreshSimulator === undefined) delete process.env.OROT_DETOX_RELEASE_FRESH_SIMULATOR;
    else process.env.OROT_DETOX_RELEASE_FRESH_SIMULATOR = previousFreshSimulator;
    if (previousSharding === undefined) delete process.env.OROT_DETOX_RELEASE_SHARDING;
    else process.env.OROT_DETOX_RELEASE_SHARDING = previousSharding;
  }
}

async function runWrapperBeforeAll(
  wrapperName,
  freshSimulator,
  releaseSharding = false,
  selectedShard = wrapperName,
) {
  const beforeAllHooks = [];
  const hookTimeouts = [];
  const deviceCalls = [];
  const resetModule = requireFromRepository('./apps/mobile/e2e/storageProbeResetGuard.e2e.js');

  function loadWrapper(name) {
    const wrapperPath = join(repositoryRoot, 'apps/mobile/e2e', name);
    const wrapperSource = readFileSync(wrapperPath, 'utf8');

    // Execute nested phase wrappers with the same hook and device recorders to verify clean-install handoffs.
    runInNewContext(wrapperSource, {
      beforeAll: (hook, timeout) => {
        beforeAllHooks.push(hook);
        hookTimeouts.push(timeout ?? null);
      },
      describe: (_name, callback) => callback(),
      device: {
        clearKeychain: async () => deviceCalls.push('clearKeychain'),
        installApp: async () => deviceCalls.push('installApp'),
        uninstallApp: async () => deviceCalls.push('uninstallApp'),
      },
      process: {
        env: {
          OROT_DETOX_RELEASE_FRESH_SIMULATOR: freshSimulator ? 'true' : 'false',
          OROT_DETOX_RELEASE_SHARDING: releaseSharding ? 'true' : 'false',
          ...(releaseSharding ? { OROT_DETOX_RELEASE_SHARD: selectedShard } : {}),
        },
      },
      // Each wrapper reads the partition map; default mode loads all phases in order.
      require: (specifier) => {
        if (specifier === './release-e2e-shards.js') {
          return {
            'release-e2e.test.js': ['./storage.test.js', './smoke.test.js', './safe-area.test.js'],
            'release-e2e-data.test.js': [
              './storage-migration.test.js',
              './appointments.test.js',
              './medicalAppointmentClassification.test.js',
              './agentMemory.test.js',
              './graph.test.js',
              './checkpoint.detox.e2e.js',
            ],
          };
        }
        if (specifier === './storageProbeResetGuard.e2e.js') {
          return {
            releasePhaseResetGuard: resetModule.createStorageResetGuard(),
            resetHookTimeoutMs: resetModule.resetHookTimeoutMs,
          };
        }
        if (specifier === './release-e2e-data.test.js') {
          loadWrapper('release-e2e-data.test.js');
        }
        return {};
      },
    });
  }

  loadWrapper(wrapperName);

  const expectedHookCount =
    releaseSharding && selectedShard === 'release-e2e-data.test.js'
      ? 1
      : releaseSharding && selectedShard === 'release-e2e.test.js'
        ? 2
        : wrapperName === 'release-e2e.test.js' && !releaseSharding
          ? 3
          : 1;
  assert.equal(beforeAllHooks.length, expectedHookCount);
  for (const hook of beforeAllHooks) await hook();
  assert.deepEqual(hookTimeouts, Array(expectedHookCount).fill(241000));
  return deviceCalls;
}

async function runManualAppointmentScenario() {
  const deviceCalls = [];
  let appointmentScenario;
  const elementHandle = {
    replaceText: async () => {},
    tap: async () => {},
    tapReturnKey: async () => {},
  };
  const matcher = () => ({ withTimeout: async () => {} });
  const source = readFileSync(join(repositoryRoot, 'apps/mobile/e2e/appointments.test.js'), 'utf8');

  // Run the actual scenario body with only Detox's native selectors replaced; hosted CI still proves Simulator behavior.
  runInNewContext(source, {
    by: { id: () => ({}), label: () => ({}), text: () => ({}) },
    describe: (_name, callback) => callback(),
    device: {
      launchApp: async (options) => deviceCalls.push({ kind: 'launch', options }),
      terminateApp: async () => deviceCalls.push({ kind: 'terminate' }),
    },
    element: () => elementHandle,
    expect: () => ({
      not: { toExist: async () => {} },
      toBeVisible: async () => {},
      toExist: async () => {},
    }),
    it: (_name, callback) => {
      appointmentScenario = callback;
    },
    waitFor: () => ({ toBeVisible: matcher, toHaveText: matcher }),
  });

  assert.equal(typeof appointmentScenario, 'function');
  await appointmentScenario();
  return deviceCalls;
}

test('the default Release phases reset app state while explicit fresh shards install directly', async () => {
  assert.equal(loadDetoxConfig().behavior.init.reinstallApp, true);
  assert.equal(loadDetoxConfig({ freshSimulator: true }).behavior.init.reinstallApp, false);
  assert.equal(loadDetoxConfig({ releaseSharding: true }).behavior.init.reinstallApp, false);

  assert.deepEqual(await runWrapperBeforeAll('release-e2e.test.js', false), [
    'clearKeychain',
    'uninstallApp',
    'clearKeychain',
    'installApp',
    'uninstallApp',
    'clearKeychain',
    'installApp',
  ]);
  assert.deepEqual(await runWrapperBeforeAll('release-e2e.test.js', true), [
    'clearKeychain',
    'installApp',
    'uninstallApp',
    'clearKeychain',
    'installApp',
    'uninstallApp',
    'clearKeychain',
    'installApp',
  ]);
  assert.deepEqual(await runWrapperBeforeAll('release-e2e.test.js', false, true), [
    'clearKeychain',
    'installApp',
    'uninstallApp',
    'clearKeychain',
    'installApp',
  ]);
  assert.deepEqual(await runWrapperBeforeAll('release-e2e-data.test.js', false, true), [
    'clearKeychain',
    'installApp',
  ]);
  assert.deepEqual(await runWrapperBeforeAll('release-e2e.test.js', true, true), [
    'clearKeychain',
    'installApp',
    'uninstallApp',
    'clearKeychain',
    'installApp',
  ]);
  assert.deepEqual(await runWrapperBeforeAll('release-e2e-data.test.js', true, true), [
    'clearKeychain',
    'installApp',
  ]);
  assert.deepEqual(
    await runWrapperBeforeAll('release-e2e.test.js', true, true, 'release-e2e-data.test.js'),
    ['clearKeychain', 'installApp'],
  );
});

test('manual appointment probe avoids terminating its fresh first launch and keeps both explicit restarts', async () => {
  const calls = await runManualAppointmentScenario();
  const launches = calls.filter(({ kind }) => kind === 'launch');

  assert.equal(launches.length, 3);
  assert.deepEqual(
    launches.map(({ options }) => options.newInstance),
    [false, false, false],
  );
  assert.deepEqual(
    calls.map(({ kind }) => kind),
    ['launch', 'terminate', 'launch', 'terminate', 'launch'],
  );
});

test('runs storage probes on the phase-owned clean installs without clearing their keys mid-suite', async () => {
  const releaseShards = requireFromRepository('./apps/mobile/e2e/release-e2e-shards.js');
  const smokeCalls = await runSmokeSetup();

  // Safe Area stays fresh on the UI worker, while stateful data starts on the second worker.
  assert.deepEqual(releaseShards['release-e2e.test.js'].slice(0, 2), [
    './storage.test.js',
    './smoke.test.js',
  ]);
  assert.equal(releaseShards['release-e2e.test.js'][2], './safe-area.test.js');
  assert.equal(releaseShards['release-e2e-data.test.js'][0], './storage-migration.test.js');
  assert.deepEqual(smokeCalls, [
    {
      kind: 'launch',
      options: {
        newInstance: true,
        languageAndLocale: { language: 'en', locale: 'en_US' },
        launchArgs: { OROT_STORAGE_DIAGNOSTICS: 'enabled' },
      },
    },
  ]);
});
