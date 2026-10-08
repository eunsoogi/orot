import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const requireFromRepository = createRequire(join(repositoryRoot, 'package.json'));
const releaseJestConfig = requireFromRepository('./apps/mobile/e2e/release-e2e.jest.config.js');
const releaseShards = requireFromRepository('./apps/mobile/e2e/release-e2e-shards.js');
const releaseSuiteFiles = requireFromRepository('./apps/mobile/e2e/release-e2e-suite-files.js');

test('Release assigns each ordered scenario shard to an isolated Detox worker', () => {
  // Each wrapper owns one simulator so first-use, data, and fresh-install state stay separate.
  assert.deepEqual(releaseJestConfig.testMatch, [
    '<rootDir>/e2e/release-e2e.test.js',
    '<rootDir>/e2e/release-e2e-data.test.js',
    '<rootDir>/e2e/release-e2e-storage.test.js',
  ]);
  assert.equal(releaseJestConfig.maxWorkers, 3);
  const assignedSuites = Object.values(releaseShards).flat();
  assert.deepEqual(assignedSuites, releaseSuiteFiles);
  assert.equal(new Set(assignedSuites).size, releaseSuiteFiles.length);
});
