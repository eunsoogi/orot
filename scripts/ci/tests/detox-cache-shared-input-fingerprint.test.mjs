import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { computeDetoxDerivedDataFingerprints } from '../detox-cache-fingerprint.mjs';
import {
  createFixtureRepository,
  git,
  runCacheCommand,
  writeFixtureFile,
} from './fixtures/detox-derived-data-cache.mjs';

const fingerprintCli = new URL('../detox-cache-fingerprint-cli.mjs', import.meta.url);

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

test('prints a JSON build-input drift snapshot for the cache workflow to overlap with restore', () => {
  const root = createFixtureRepository();
  try {
    writeFixtureFile(root, 'apps/mobile/App.tsx', 'changed after shared fingerprinting');
    git(root, 'add', '--all');
    const result = execFileSync(
      process.execPath,
      [fingerprintCli.pathname, '--changed-build-inputs'],
      { cwd: root, encoding: 'utf8' },
    );
    assert.deepEqual(JSON.parse(result), ['apps/mobile/App.tsx']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('uses only a complete precomputed drift snapshot and retains synchronous fallback', () => {
  const root = createFixtureRepository();
  const runnerTemp = join(root, 'runner-temp');
  mkdirSync(runnerTemp);
  const scanPath = join(runnerTemp, 'build-input-changes.json');
  const fingerprints = computeDetoxDerivedDataFingerprints(root);
  const environment = {
    RUNNER_TEMP: runnerTemp,
    DETOX_CACHE_BUILD_INPUTS_SCAN_PATH: scanPath,
    EXPECTED_COCOAPODS_INPUT_HASHES_JSON: JSON.stringify({
      privacyManifest: fingerprints.privacyManifestInputHash,
      projectFile: fingerprints.cocoapodsProjectInputHash,
    }),
    EXPECTED_DETOX_BUILD_INPUT_FINGERPRINT: fingerprints.buildInputs,
    EXPECTED_DETOX_NATIVE_DEPENDENCY_FINGERPRINT: fingerprints.nativeDependencies,
  };

  try {
    writeFileSync(scanPath, '[]\n');
    const shared = runCacheCommand(root, 'prepare', 'release', environment);
    assert.match(shared, /build_input_scan_source=precomputed/);
    assert.match(shared, /fingerprint_source=shared/);

    writeFixtureFile(root, 'apps/mobile/App.tsx', 'changed after shared fingerprinting');
    git(root, 'add', '--all');
    writeFileSync(scanPath, '["apps/mobile/App.tsx"]\n');
    assert.throws(
      () => runCacheCommand(root, 'prepare', 'release', environment),
      (error) =>
        error.stdout.toString().includes('build_input_scan_source=precomputed') &&
        error.stdout.toString().includes('fingerprint_source=local') &&
        /prebuild_fingerprint_mismatch before cache lookup/.test(error.stderr.toString()),
    );

    rmSync(scanPath, { force: true });
    assert.throws(
      () => runCacheCommand(root, 'prepare', 'release', environment),
      (error) =>
        error.stdout.toString().includes('build_input_scan_source=synchronous') &&
        error.stdout.toString().includes('fingerprint_source=local') &&
        /prebuild_fingerprint_mismatch before cache lookup/.test(error.stderr.toString()),
    );

    writeFileSync(scanPath, '{malformed snapshot');
    assert.throws(
      () => runCacheCommand(root, 'prepare', 'release', environment),
      (error) =>
        error.stdout.toString().includes('build_input_scan_source=synchronous') &&
        error.stdout.toString().includes('fingerprint_source=local') &&
        /prebuild_fingerprint_mismatch before cache lookup/.test(error.stderr.toString()),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
