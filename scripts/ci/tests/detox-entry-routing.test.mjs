import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const requireFromRepository = createRequire(join(repositoryRoot, 'package.json'));
const selectEntryRoute = requireFromRepository('./apps/mobile/e2e/selectEntryRoute.js').selectEntryRoute;
const mobileConfig = requireFromRepository('./apps/mobile/.detoxrc.js');
const releaseJestConfig = requireFromRepository('./apps/mobile/e2e/release-e2e.jest.config.js');
const openAiJestConfig = requireFromRepository('./apps/mobile/e2e/openai-provider.jest.config.js');

test('routes the existing launch arguments to one Release entry and rejects unknown selectors', () => {
  assert.equal(selectEntryRoute({}), 'storage');
  assert.equal(selectEntryRoute({ OROT_STORAGE_PROBE: 'legacy' }), 'storage');
  assert.equal(selectEntryRoute({ OROT_AGENT_MEMORY_PROBE: 'fresh' }), 'agent-memory');
  assert.equal(selectEntryRoute({ OROT_E2E_PROBE: 'graph' }), 'graph');
  assert.equal(selectEntryRoute({ OROT_E2E_PROBE: 'checkpoint' }), 'checkpoint');
  assert.throws(() => selectEntryRoute({ OROT_E2E_PROBE: 'typo' }), /Unsupported OROT_E2E_PROBE/);
  assert.throws(
    () => selectEntryRoute({ OROT_E2E_PROBE: 'graph', OROT_AGENT_MEMORY_PROBE: 'fresh' }),
    /Conflicting Orot E2E probe selectors/,
  );
  assert.throws(
    () => selectEntryRoute({ OROT_AGENT_MEMORY_PROBE: 'fresh', OROT_STORAGE_PROBE: 'fresh' }),
    /Conflicting Orot E2E probe selectors/,
  );
  assert.throws(
    () => selectEntryRoute({ OROT_E2E_PROBE: 'checkpoint', OROT_STORAGE_PROBE: 'fresh' }),
    /Conflicting Orot E2E probe selectors/,
  );
});

test('the shared Release app config bundles the router and explicitly selects every existing Release suite', () => {
  const buildCommand = mobileConfig.apps['ios.release'].build;
  assert.match(buildCommand, /ENTRY_FILE=e2e\/e2eRouterEntry\.tsx/);
  assert.equal(mobileConfig.testRunner.args.config, 'e2e/release-e2e.jest.config.js');
  assert.deepEqual(releaseJestConfig.testMatch, [
    '<rootDir>/e2e/smoke.test.js',
    '<rootDir>/e2e/appointments.test.js',
    '<rootDir>/e2e/storage.test.js',
    '<rootDir>/e2e/agentMemory.test.js',
    '<rootDir>/e2e/graph.test.js',
    '<rootDir>/e2e/checkpoint.detox.e2e.js',
  ]);
  assert.deepEqual(openAiJestConfig.testMatch, ['<rootDir>/e2e/openai-provider.e2e.js']);
  assert.deepEqual(releaseJestConfig.testPathIgnorePatterns, []);
  assert.equal(releaseJestConfig.rootDir, '..');
});
