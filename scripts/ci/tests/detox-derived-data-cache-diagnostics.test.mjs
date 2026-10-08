import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { computeDetoxCacheFingerprints } from '../detox-cache-fingerprint.mjs';
import {
  createFixtureRepository,
  runCacheCommand,
  writeFixtureFile,
} from './fixtures/detox-derived-data-cache.mjs';

const workflowPath = fileURLToPath(
  new URL('../../../.github/workflows/detox-e2e-profile.yml', import.meta.url),
);

test('records the invalidation diagnostic and passes prebuild hashes to manifest writing', () => {
  const workflow = readFileSync(workflowPath, 'utf8');
  assert.match(
    workflow,
    /DERIVED_DATA_CACHE_DIAGNOSTIC: \$\{\{ steps\.prepare_derived_data_cache\.outputs\.derived_data_cache_diagnostic \}\}/,
  );
  assert.match(
    workflow,
    /EXPECTED_DETOX_BUILD_INPUT_FINGERPRINT: \$\{\{ steps\.profile_derived_data_cache\.outputs\.build_inputs \}\}/,
  );
  assert.match(
    workflow,
    /EXPECTED_DETOX_NATIVE_DEPENDENCY_FINGERPRINT: \$\{\{ steps\.profile_derived_data_cache\.outputs\.native_dependencies \}\}/,
  );
  assert.match(
    workflow,
    /node scripts\/ci\/detox-derived-data-cache\.mjs write .*\| tee -a artifacts\/detox\/native-cache\.log/,
  );
});

test('invalidates a cached app manifest when its build profile changes', () => {
  const root = createFixtureRepository();
  const derivedData = join(root, 'apps/mobile/ios/build-detox-release');
  const manifestPath = join(derivedData, '.orot-detox-cache.json');

  try {
    mkdirSync(derivedData, { recursive: true });
    runCacheCommand(root, 'write');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.profile = 'openai-provider';
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const output = runCacheCommand(root, 'prepare');
    assert.match(output, /classification=invalidated/);
    assert.match(output, /mismatch_fields=profile/);
    assert.equal(existsSync(derivedData), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reports the static mismatch field and hashes before invalidating an incompatible cache', () => {
  const root = createFixtureRepository();
  const derivedData = join(root, 'apps/mobile/ios/build-detox-release');
  const manifestPath = join(derivedData, '.orot-detox-cache.json');
  const outputPath = join(root, 'prepare-output.txt');

  try {
    mkdirSync(derivedData, { recursive: true });
    runCacheCommand(root, 'write');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.toolchain.xcodeVersion = 'private-value-must-not-be-logged';
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const output = runCacheCommand(root, 'prepare', { GITHUB_OUTPUT: outputPath });
    assert.match(output, /classification=invalidated/);
    assert.match(output, /reason=manifest_incompatible/);
    assert.match(output, /mismatch_fields=toolchain\.xcodeVersion/);
    assert.match(output, /cached_toolchain_sha256=[a-f0-9]{64}/);
    assert.match(output, /expected_toolchain_sha256=[a-f0-9]{64}/);
    assert.doesNotMatch(output, /private-value-must-not-be-logged/);
    assert.match(
      readFileSync(outputPath, 'utf8'),
      /derived_data_cache_reason=manifest_incompatible/,
    );
    assert.equal(existsSync(derivedData), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('keeps unknown toolchain manifest keys out of diagnostic and GitHub output fields', () => {
  const root = createFixtureRepository();
  const derivedData = join(root, 'apps/mobile/ios/build-detox-release');
  const manifestPath = join(derivedData, '.orot-detox-cache.json');
  const outputPath = join(root, 'prepare-output.txt');

  try {
    mkdirSync(derivedData, { recursive: true });
    runCacheCommand(root, 'write');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.toolchain['unknown\nforged_output=sentinel_marker'] = 'untrusted-value';
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const output = runCacheCommand(root, 'prepare', { GITHUB_OUTPUT: outputPath });
    const githubOutput = readFileSync(outputPath, 'utf8');
    assert.match(output, /mismatch_fields=toolchain\.unknown_fields/);
    assert.match(githubOutput, /derived_data_cache_mismatch_fields=toolchain\.unknown_fields/);
    assert.doesNotMatch(output, /forged_output|sentinel_marker/);
    assert.doesNotMatch(githubOutput, /forged_output|sentinel_marker/);
    assert.equal(existsSync(derivedData), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refuses to write a cache manifest when build fingerprints drift after the build', () => {
  const root = createFixtureRepository();
  const derivedData = join(root, 'apps/mobile/ios/build-detox-release');
  const manifestPath = join(derivedData, '.orot-detox-cache.json');
  const outputPath = join(root, 'write-output.txt');

  try {
    mkdirSync(derivedData, { recursive: true });
    const beforeBuild = computeDetoxCacheFingerprints(root);
    writeFixtureFile(root, 'apps/mobile/ios/Podfile.lock', 'changed after the build fingerprint');
    execFileSync('git', ['add', '--all'], { cwd: root, stdio: 'ignore' });

    assert.throws(
      () =>
        runCacheCommand(root, 'write', {
          EXPECTED_DETOX_BUILD_INPUT_FINGERPRINT: beforeBuild.buildInputs,
          EXPECTED_DETOX_NATIVE_DEPENDENCY_FINGERPRINT: beforeBuild.nativeDependencies,
          GITHUB_OUTPUT: outputPath,
        }),
      (error) => /prebuild_fingerprint_mismatch/.test(error.stderr.toString()),
    );
    const output = readFileSync(outputPath, 'utf8');
    assert.match(output, /manifest_fingerprint_match=false/);
    assert.match(output, /manifest_build_inputs=[a-f0-9]{64}/);
    assert.match(output, /manifest_native_dependencies=[a-f0-9]{64}/);
    assert.equal(existsSync(manifestPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('names changed build inputs when refusing a drifted cache manifest', () => {
  const root = createFixtureRepository();
  const derivedData = join(root, 'apps/mobile/ios/build-detox-release');

  try {
    mkdirSync(derivedData, { recursive: true });
    const beforeBuild = computeDetoxCacheFingerprints(root);
    writeFixtureFile(root, 'apps/mobile/ios/Podfile.lock', 'changed during the build');
    const injectedPath = 'apps/mobile/ios/unexpected\nforged_output=sentinel';
    writeFixtureFile(root, injectedPath, 'untrusted path');

    assert.throws(
      () =>
        runCacheCommand(root, 'write', {
          EXPECTED_DETOX_BUILD_INPUT_FINGERPRINT: beforeBuild.buildInputs,
          EXPECTED_DETOX_NATIVE_DEPENDENCY_FINGERPRINT: beforeBuild.nativeDependencies,
        }),
      (error) => {
        const output = error.stdout.toString();
        const diagnostic = output.split('\n').find((line) => line.includes('build_input_changes='));
        const prefix = 'build_input_changes=';
        const reportedPaths = JSON.parse(
          diagnostic.slice(diagnostic.indexOf(prefix) + prefix.length),
        );
        assert.deepEqual(reportedPaths, ['apps/mobile/ios/Podfile.lock', injectedPath].sort());
        assert.doesNotMatch(output, /\nforged_output=sentinel/);
        return /prebuild_fingerprint_mismatch/.test(error.stderr.toString());
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
