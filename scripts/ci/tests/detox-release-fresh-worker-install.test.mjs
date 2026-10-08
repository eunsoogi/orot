import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

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

async function runWrapperBeforeAll(wrapperName, freshSimulator, releaseSharding = false) {
  const beforeAllHooks = [];
  const deviceCalls = [];
  const wrapperPath = join(repositoryRoot, 'apps/mobile/e2e', wrapperName);
  const wrapperSource = readFileSync(wrapperPath, 'utf8');

  // Execute real phase hooks with Detox and Jest globals replaced by ordered call recorders.
  runInNewContext(wrapperSource, {
    beforeAll: (hook) => beforeAllHooks.push(hook),
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
        ...(releaseSharding ? { OROT_DETOX_RELEASE_SHARD: wrapperName } : {}),
      },
    },
    // Each wrapper reads the partition map; default mode loads both parts inside ordered phases.
    require: (specifier) =>
      specifier === './release-e2e-shards.js'
        ? { 'release-e2e.test.js': [], 'release-e2e-data.test.js': [] }
        : {},
  });

  const expectedHookCount = wrapperName === 'release-e2e.test.js' && !releaseSharding ? 2 : 1;
  assert.equal(beforeAllHooks.length, expectedHookCount);
  for (const hook of beforeAllHooks) await hook();
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
  ]);
  assert.deepEqual(await runWrapperBeforeAll('release-e2e.test.js', true), [
    'clearKeychain',
    'installApp',
    'uninstallApp',
    'clearKeychain',
    'installApp',
  ]);
  for (const wrapperName of ['release-e2e.test.js', 'release-e2e-data.test.js']) {
    assert.deepEqual(await runWrapperBeforeAll(wrapperName, false, true), [
      'clearKeychain',
      'installApp',
    ]);
  }
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
