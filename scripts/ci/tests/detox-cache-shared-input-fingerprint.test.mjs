import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function sharedOutput(fingerprints) {
  return {
    build_inputs: fingerprints.buildInputs,
    build_input_count: String(fingerprints.buildInputCount),
    native_dependencies: fingerprints.nativeDependencies,
    native_dependency_input_count: String(fingerprints.nativeDependencyInputCount),
    privacy_manifest_input_sha256: fingerprints.privacyManifestInputHash,
    cocoapods_project_input_sha256: fingerprints.cocoapodsProjectInputHash,
  };
}

function runFingerprintResolver(root, sharedFingerprints) {
  const runnerTemp = join(root, 'runner-temp');
  mkdirSync(runnerTemp, { recursive: true });
  const outputPath = join(runnerTemp, 'github-output');
  const environmentPath = join(runnerTemp, 'github-env');
  writeFileSync(outputPath, '');
  writeFileSync(environmentPath, '');
  const result = spawnSync(
    process.execPath,
    [fingerprintCli.pathname, '--resolve-shared-derived-data-only'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        DETOX_SHARED_FINGERPRINTS_JSON: sharedFingerprints,
        GITHUB_ENV: environmentPath,
        GITHUB_OUTPUT: outputPath,
      },
    },
  );
  return {
    ...result,
    output: readFileSync(outputPath, 'utf8'),
    environment: readFileSync(environmentPath, 'utf8'),
  };
}

test('resolves complete shared fingerprints without recomputing on a profile runner', () => {
  const root = createFixtureRepository();
  const shared = sharedOutput(computeDetoxDerivedDataFingerprints(root));
  try {
    const result = runFingerprintResolver(root, JSON.stringify(shared));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /fingerprint_source=shared/);
    assert.ok(result.output.includes(`fingerprints=${JSON.stringify(shared)}`));
    assert.ok(
      result.environment.includes(`EXPECTED_DETOX_BUILD_INPUT_FINGERPRINT=${shared.build_inputs}`),
    );
    assert.ok(
      result.environment.includes(
        `EXPECTED_DETOX_NATIVE_DEPENDENCY_FINGERPRINT=${shared.native_dependencies}`,
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('computes local fingerprints when the shared workflow output set is empty', () => {
  const root = createFixtureRepository();
  const emptyShared = Object.fromEntries(
    Object.keys(sharedOutput(computeDetoxDerivedDataFingerprints(root))).map((key) => [key, '']),
  );
  try {
    const result = runFingerprintResolver(root, JSON.stringify(emptyShared));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /fingerprint_source=local/);
    assert.ok(
      result.output.includes(
        `fingerprints=${JSON.stringify(sharedOutput(computeDetoxDerivedDataFingerprints(root)))}`,
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects malformed nonempty shared hashes instead of falling back', () => {
  const root = createFixtureRepository();
  const malformed = sharedOutput(computeDetoxDerivedDataFingerprints(root));
  malformed.build_inputs = 'not-a-sha256-hash';
  try {
    const result = runFingerprintResolver(root, JSON.stringify(malformed));
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /Shared Detox fingerprint build_inputs must be a SHA-256 hex value/,
    );
    assert.doesNotMatch(result.stdout, /fingerprint_source=local/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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
