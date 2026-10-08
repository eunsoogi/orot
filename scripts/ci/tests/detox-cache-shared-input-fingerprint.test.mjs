import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { computeDetoxDerivedDataFingerprints } from '../detox-cache-fingerprint.mjs';
import {
  createFixtureRepository,
  git,
  runCacheCommand,
  writeFixtureFile,
} from './fixtures/detox-derived-data-cache.mjs';

test('reuses shared fingerprints only while cache input paths stay unchanged', () => {
  const root = createFixtureRepository();
  const runnerTemp = join(root, 'runner-temp');
  mkdirSync(runnerTemp);
  const fingerprints = computeDetoxDerivedDataFingerprints(root);
  // CI re-emits the shared job's source hashes into these profile-scoped variables.
  const environment = {
    RUNNER_TEMP: runnerTemp,
    EXPECTED_COCOAPODS_INPUT_HASHES_JSON: JSON.stringify({
      privacyManifest: fingerprints.privacyManifestInputHash,
      projectFile: fingerprints.cocoapodsProjectInputHash,
    }),
    EXPECTED_DETOX_BUILD_INPUT_FINGERPRINT: fingerprints.buildInputs,
    EXPECTED_DETOX_NATIVE_DEPENDENCY_FINGERPRINT: fingerprints.nativeDependencies,
  };

  try {
    assert.match(
      runCacheCommand(root, 'prepare', 'release', environment),
      /fingerprint_source=shared/,
    );

    writeFixtureFile(root, 'apps/mobile/App.tsx', 'changed after shared fingerprinting');
    git(root, 'add', '--all');
    assert.throws(
      () => runCacheCommand(root, 'prepare', 'release', environment),
      (error) =>
        error.stdout.toString().includes('fingerprint_source=local') &&
        /prebuild_fingerprint_mismatch before cache lookup/.test(error.stderr.toString()),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
