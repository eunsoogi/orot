import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  computeDetoxCacheFingerprints,
  computeDetoxDerivedDataFingerprints,
} from '../detox-cache-fingerprint.mjs';
import {
  createFixtureRepository,
  git,
  writeFixtureFile,
} from './fixtures/detox-derived-data-cache.mjs';
import { listChangedDetoxBuildInputs } from '../detox-cache-fingerprint.mjs';

test('reads overlapping DerivedData fingerprint inputs once', () => {
  const root = createFixtureRepository();
  try {
    const readPaths = new Set();
    const countedRead = (path) => {
      assert.equal(readPaths.has(path), false, `Repeated fingerprint read: ${path}`);
      readPaths.add(path);
      return readFileSync(path);
    };
    const fingerprints = computeDetoxDerivedDataFingerprints(root, {}, countedRead);

    assert.equal(readPaths.size, fingerprints.buildInputCount);
    assert.ok(fingerprints.nativeDependencyInputCount < fingerprints.buildInputCount);
    assert.ok(readPaths.has(join(root, 'apps/mobile/ios/Podfile')));
    assert.deepEqual(fingerprints, computeDetoxDerivedDataFingerprints(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('hashes unstaged tracked and untracked inputs while excluding generated output', () => {
  const root = createFixtureRepository();
  try {
    const initial = computeDetoxCacheFingerprints(root);

    writeFixtureFile(root, 'apps/mobile/App.tsx', 'unstaged app source');
    const unstagedSource = computeDetoxCacheFingerprints(root);
    assert.notEqual(unstagedSource.buildInputs, initial.buildInputs);

    writeFixtureFile(root, 'apps/mobile/ios/Podfile.lock', 'unstaged native lock');
    const unstagedLock = computeDetoxCacheFingerprints(root);
    assert.notEqual(unstagedLock.reactNativeArtifacts, initial.reactNativeArtifacts);
    assert.notEqual(unstagedLock.nativeDependencies, initial.nativeDependencies);

    writeFixtureFile(root, 'pnpm-lock.yaml', 'unstaged workspace lock');
    const unstagedWorkspaceLock = computeDetoxCacheFingerprints(root);
    assert.notEqual(unstagedWorkspaceLock.reactNativeArtifacts, unstagedLock.reactNativeArtifacts);
    assert.notEqual(unstagedWorkspaceLock.nativeDependencies, unstagedLock.nativeDependencies);

    writeFixtureFile(
      root,
      'apps/mobile/.detoxrc.js',
      readFileSync(join(root, 'apps/mobile/.detoxrc.js'), 'utf8').replace(
        'ios/build-detox-release',
        'ios/build-detox-release-next',
      ),
    );
    const unstagedConfiguration = computeDetoxCacheFingerprints(root);
    assert.notEqual(
      unstagedConfiguration.nativeDependencies,
      unstagedWorkspaceLock.nativeDependencies,
    );

    writeFixtureFile(root, 'apps/mobile/NewScreen.tsx', 'untracked app source');
    const untrackedSource = computeDetoxCacheFingerprints(root);
    assert.notEqual(untrackedSource.buildInputs, unstagedConfiguration.buildInputs);
    assert.ok(listChangedDetoxBuildInputs(root).includes('apps/mobile/NewScreen.tsx'));

    git(root, 'rm', '--cached', 'scripts/ci/build-ios-simulator-app.sh');
    const beforeUntrackedBuilderEdit = computeDetoxCacheFingerprints(root);
    assert.equal(beforeUntrackedBuilderEdit.buildInputs, untrackedSource.buildInputs);
    writeFixtureFile(root, 'scripts/ci/build-ios-simulator-app.sh', 'unstaged production builder');
    const untrackedBuilder = computeDetoxCacheFingerprints(root);
    assert.notEqual(untrackedBuilder.buildInputs, beforeUntrackedBuilderEdit.buildInputs);
    assert.notEqual(
      untrackedBuilder.nativeDependencies,
      beforeUntrackedBuilderEdit.nativeDependencies,
    );
    assert.ok(listChangedDetoxBuildInputs(root).includes('scripts/ci/build-ios-simulator-app.sh'));

    const beforeGeneratedOutput = computeDetoxCacheFingerprints(root);
    writeFixtureFile(root, 'apps/mobile/ios/build-detox-release/generated.db', 'derived output');
    writeFixtureFile(root, 'apps/mobile/ios/build/generated/ios/ReactCodegen.xcconfig', 'codegen');
    assert.deepEqual(computeDetoxCacheFingerprints(root), beforeGeneratedOutput);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('invalidates app and native fingerprints when the mobile manifest changes', () => {
  const root = createFixtureRepository();
  try {
    const initial = computeDetoxCacheFingerprints(root);

    // Native feature flags in the app manifest can change both bundle and CocoaPods output.
    writeFixtureFile(
      root,
      'apps/mobile/package.json',
      '{"name":"@orot/mobile","type":"commonjs","op-sqlite":{"fts5":true}}',
    );
    const afterNativeFeatureChange = computeDetoxCacheFingerprints(root);

    assert.notEqual(afterNativeFeatureChange.buildInputs, initial.buildInputs);
    assert.notEqual(afterNativeFeatureChange.nativeDependencies, initial.nativeDependencies);
    assert.equal(afterNativeFeatureChange.reactNativeArtifacts, initial.reactNativeArtifacts);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ignores CI orchestration changes but tracks app build driver changes', () => {
  const root = createFixtureRepository();
  try {
    const initial = computeDetoxCacheFingerprints(root);
    // These files coordinate CI/cache behavior; app output inputs are hashed separately.
    for (const path of [
      '.github/workflows/e2e-test.yml',
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

    writeFixtureFile(
      root,
      'scripts/ci/build-ios-simulator-app.sh',
      'changed production build driver',
    );
    git(root, 'add', '--all');
    const afterProductionBuildDriverChange = computeDetoxCacheFingerprints(root);
    assert.notEqual(
      afterProductionBuildDriverChange.buildInputs,
      afterBuildDriverChange.buildInputs,
    );
    assert.notEqual(
      afterProductionBuildDriverChange.nativeDependencies,
      afterBuildDriverChange.nativeDependencies,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
