import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createFixtureRepository, runCacheCommand } from './fixtures/detox-derived-data-cache.mjs';

// Production CI validates and caches its app without provisioning Detox runtime artifacts.
test('reuses an exact production app cache when Detox outputs are absent', () => {
  const root = createFixtureRepository();
  const frameworkRoot = join(root, 'detox-framework');
  try {
    rmSync(frameworkRoot, { recursive: true, force: true });
    mkdirSync(join(root, 'apps/mobile/ios/build-production'), { recursive: true });
    runCacheCommand(root, 'write', 'production');

    const prepared = runCacheCommand(root, 'prepare', 'production');
    assert.match(prepared, /classification=exact/);
    assert.match(prepared, /app_reusable=true/);
    assert.equal(existsSync(frameworkRoot), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rewrites an invalidated production cache without Detox outputs', () => {
  const root = createFixtureRepository();
  const derivedData = join(root, 'apps/mobile/ios/build-production');
  const frameworkRoot = join(root, 'detox-framework');
  const manifestPath = join(derivedData, '.orot-detox-cache.json');
  try {
    mkdirSync(derivedData, { recursive: true });
    runCacheCommand(root, 'write', 'production');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.schemaVersion = 4;
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    rmSync(frameworkRoot, { recursive: true, force: true });

    assert.match(runCacheCommand(root, 'prepare', 'production'), /classification=invalidated/);
    assert.equal(existsSync(derivedData), false);
    assert.equal(existsSync(frameworkRoot), false);

    runCacheCommand(root, 'write', 'production');
    const rebuilt = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(rebuilt.detoxArtifacts, undefined);
    assert.match(runCacheCommand(root, 'prepare', 'production'), /app_reusable=true/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('invalidates a combined Detox cache when the Xcode build identity changes', () => {
  const root = createFixtureRepository();
  const derivedData = join(root, 'apps/mobile/ios/build-detox-release');
  const manifestPath = join(derivedData, '.orot-detox-cache.json');
  const xcodeBuildA = 'a'.repeat(64);
  const xcodeBuildB = 'b'.repeat(64);
  try {
    mkdirSync(derivedData, { recursive: true });
    runCacheCommand(root, 'write', 'release', { XCODEBUILD_FINGERPRINT: xcodeBuildA });
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.toolchain.xcodebuildFingerprint, xcodeBuildA);

    const exact = runCacheCommand(root, 'prepare', 'release', {
      XCODEBUILD_FINGERPRINT: xcodeBuildA,
    });
    assert.match(exact, /classification=exact/);
    assert.match(exact, /app_reusable=true/);

    const changed = runCacheCommand(root, 'prepare', 'release', {
      XCODEBUILD_FINGERPRINT: xcodeBuildB,
    });
    assert.match(changed, /classification=invalidated/);
    assert.match(changed, /toolchain\.xcodebuildFingerprint/);
    assert.equal(existsSync(derivedData), false);
    assert.equal(existsSync(join(root, 'detox-framework/framework')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
