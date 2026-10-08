import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const requireFromRepository = createRequire(join(repositoryRoot, 'package.json'));

function loadDetoxConfig(releaseShardingEnabled) {
  const previousSharding = process.env.OROT_DETOX_RELEASE_SHARDING;
  const configPath = './apps/mobile/.detoxrc.js';
  const resolvedConfigPath = requireFromRepository.resolve(configPath);
  const cachedConfig = requireFromRepository.cache[resolvedConfigPath];
  if (releaseShardingEnabled) process.env.OROT_DETOX_RELEASE_SHARDING = 'true';
  else delete process.env.OROT_DETOX_RELEASE_SHARDING;
  delete requireFromRepository.cache[resolvedConfigPath];
  try {
    return requireFromRepository(configPath);
  } finally {
    if (cachedConfig) requireFromRepository.cache[resolvedConfigPath] = cachedConfig;
    else delete requireFromRepository.cache[resolvedConfigPath];
    if (previousSharding === undefined) delete process.env.OROT_DETOX_RELEASE_SHARDING;
    else process.env.OROT_DETOX_RELEASE_SHARDING = previousSharding;
  }
}

async function runWrapperBeforeAll(wrapperName, releaseShardingEnabled) {
  const beforeAllHooks = [];
  const deviceCalls = [];
  const wrapperPath = join(repositoryRoot, 'apps/mobile/e2e', wrapperName);
  const wrapperSource = readFileSync(wrapperPath, 'utf8');

  // Execute the real wrapper setup with Detox and Jest globals replaced by ordered call recorders.
  runInNewContext(wrapperSource, {
    beforeAll: (hook) => beforeAllHooks.push(hook),
    device: {
      clearKeychain: async () => deviceCalls.push('clearKeychain'),
      installApp: async () => deviceCalls.push('installApp'),
    },
    process: {
      env: { OROT_DETOX_RELEASE_SHARDING: releaseShardingEnabled ? 'true' : 'false' },
    },
    require: (specifier) => (specifier === './release-e2e-shards.js' ? { [wrapperName]: [] } : {}),
  });

  assert.equal(beforeAllHooks.length, 1);
  await beforeAllHooks[0]();
  return deviceCalls;
}

test('fresh Release workers install directly while local Detox keeps its reinstall behavior', async () => {
  // CI sets the shard marker only after preparing new Simulator clones; local Release runs keep Detox reinstall.
  assert.equal(loadDetoxConfig(false).behavior.init.reinstallApp, true);
  assert.equal(loadDetoxConfig(true).behavior.init.reinstallApp, false);

  for (const wrapperName of ['release-e2e.test.js', 'release-e2e-data.test.js']) {
    assert.deepEqual(await runWrapperBeforeAll(wrapperName, false), ['clearKeychain']);
    assert.deepEqual(await runWrapperBeforeAll(wrapperName, true), ['clearKeychain', 'installApp']);
  }
});
