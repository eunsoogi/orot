import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import test from 'node:test';
import { computeDetoxCacheFingerprints } from '../detox-cache-fingerprint.mjs';
import {
  createFixtureRepository,
  git,
  writeFixtureFile,
} from './fixtures/detox-derived-data-cache.mjs';

test('ignores CI orchestration changes but tracks app build driver changes', () => {
  const root = createFixtureRepository();
  try {
    const initial = computeDetoxCacheFingerprints(root);
    // These files coordinate CI/cache behavior; app output inputs are hashed separately.
    for (const path of [
      '.github/workflows/ci.yml',
      '.github/workflows/detox-e2e-profile.yml',
      'scripts/ci/detox-cache-fingerprint.mjs',
      'scripts/ci/detox-cache-fingerprint-cli.mjs',
      'scripts/ci/detox-derived-data-cache.mjs',
    ]) {
      writeFixtureFile(root, path, `changed orchestration: ${path}`);
    }
    git(root, 'add', '--all');
    const afterOrchestrationChange = computeDetoxCacheFingerprints(root);
    assert.deepEqual(afterOrchestrationChange, initial);

    writeFixtureFile(root, 'scripts/ci/build-detox-apps.sh', 'changed app build driver');
    git(root, 'add', '--all');
    const afterBuildDriverChange = computeDetoxCacheFingerprints(root);
    assert.notEqual(afterBuildDriverChange.buildInputs, initial.buildInputs);
    assert.notEqual(afterBuildDriverChange.nativeDependencies, initial.nativeDependencies);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
