import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  createFixtureRepository,
  runCacheCommand,
  writeFixtureFile,
} from './fixtures/detox-derived-data-cache.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const ciWorkflow = readFileSync(join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8');
const profileWorkflow = readFileSync(
  join(repositoryRoot, '.github/workflows/detox-e2e-profile.yml'),
  'utf8',
);
const mobilePackage = readFileSync(join(repositoryRoot, 'apps/mobile/package.json'), 'utf8');

function workflowStep(source, name) {
  const start = source.indexOf('- name: ' + name);
  const end = source.indexOf('\n      - name:', start + 1);
  return start < 0 ? '' : source.slice(start, end < 0 ? undefined : end);
}

test('reuses only an exact cache with intact app metadata, architecture, bundle, and digests', () => {
  const root = createFixtureRepository();
  const appRoot =
    'apps/mobile/ios/build-detox-release/Build/Products/Release-iphonesimulator/Orot.app';
  const podsOutput =
    'apps/mobile/ios/build-detox-release/Build/Intermediates.noindex/Pods.build/Release-iphonesimulator/pod.o';
  try {
    mkdirSync(join(root, 'apps/mobile/ios/build-detox-release'), { recursive: true });
    runCacheCommand(root, 'write');
    writeFixtureFile(root, podsOutput, 'preserve-pod');
    assert.match(runCacheCommand(root, 'prepare'), /app_reusable=true/);

    writeFixtureFile(root, join(appRoot, 'main.jsbundle'), 'corrupted-js-bundle');
    const corruptedBundle = runCacheCommand(root, 'prepare');
    assert.match(corruptedBundle, /app_reuse_reason=app_artifact_digest_mismatch/);
    assert.match(corruptedBundle, /app_reusable=false/);
    assert.equal(readFileSync(join(root, podsOutput), 'utf8'), 'preserve-pod');
    assert.equal(existsSync(join(root, appRoot)), false);

    runCacheCommand(root, 'write');
    rmSync(join(root, appRoot, 'main.jsbundle'));
    const missingBundle = runCacheCommand(root, 'prepare');
    assert.match(missingBundle, /app_reuse_reason=app_embedded_bundle_missing_or_invalid/);
    assert.equal(existsSync(join(root, appRoot)), false);

    runCacheCommand(root, 'write');
    rmSync(join(root, appRoot, 'Orot'));
    const missingBinary = runCacheCommand(root, 'prepare');
    assert.match(missingBinary, /app_reuse_reason=app_binary_missing_or_invalid/);
    assert.equal(existsSync(join(root, appRoot)), false);

    runCacheCommand(root, 'write');
    writeFixtureFile(root, join(appRoot, 'Info.plist'), 'corrupted-plist');
    const invalidMetadata = runCacheCommand(root, 'prepare');
    assert.match(invalidMetadata, /app_reuse_reason=app_metadata_invalid/);
    assert.match(invalidMetadata, /app_reusable=false/);

    runCacheCommand(root, 'write');
    writeFixtureFile(root, join(appRoot, 'Info.plist'), 'wrong-bundle-id');
    const wrongIdentity = runCacheCommand(root, 'prepare');
    assert.match(wrongIdentity, /app_reuse_reason=app_metadata_mismatch/);

    runCacheCommand(root, 'write');
    writeFixtureFile(root, join(appRoot, 'Orot'), 'wrong-architecture');
    const wrongArchitecture = runCacheCommand(root, 'prepare');
    assert.match(wrongArchitecture, /app_reuse_reason=app_architecture_invalid/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('uses isolated production DerivedData only for a validated exact cache', () => {
  const root = createFixtureRepository();
  try {
    mkdirSync(join(root, 'apps/mobile/ios/build-production'), { recursive: true });
    runCacheCommand(root, 'write', 'production');
    assert.match(runCacheCommand(root, 'prepare', 'production'), /app_reusable=true/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('keeps cache misses on the existing build path and preserves every Detox oracle', () => {
  const cache = workflowStep(profileWorkflow, 'Cache Release Detox DerivedData');
  const pods = workflowStep(profileWorkflow, 'Install Detox CocoaPods dependencies');
  const build = workflowStep(profileWorkflow, 'Build Detox iOS Simulator app');
  const testRun = workflowStep(profileWorkflow, 'Run Detox iOS Simulator tests');
  const fingerprintIndex = profileWorkflow.indexOf(
    '- name: Compute stable Detox cache fingerprints',
  );
  const cacheIndex = profileWorkflow.indexOf('- name: Cache Release Detox DerivedData');
  const prepareIndex = profileWorkflow.indexOf('- name: Prepare restored Detox DerivedData cache');
  const podsIndex = profileWorkflow.indexOf('- name: Install Detox CocoaPods dependencies');
  assert.ok(fingerprintIndex >= 0 && cacheIndex > fingerprintIndex && prepareIndex > cacheIndex);
  assert.ok(podsIndex > prepareIndex);
  assert.match(cache, /path: apps\/mobile\/ios\/build-detox-release/);
  assert.match(pods, /app_reusable != 'true'/);
  assert.match(build, /app_reusable != 'true'/);
  assert.match(testRun, /run-test-suite\.sh "e2e-\$\{\{ inputs\.profile \}\}"/);
  for (const name of [
    'Prepare dedicated Detox Simulator',
    'Wait for dedicated Detox Simulator',
    'Collect simulator logs',
    'Delete dedicated Detox Simulator',
    'Upload Detox reports, logs, screenshots, and videos',
  ]) {
    assert.notEqual(profileWorkflow.indexOf('- name: ' + name), -1);
  }
});

test('reuses only the exact production app while OAuth package and harness checks always run', () => {
  const fingerprint = workflowStep(ciWorkflow, 'Compute production app cache fingerprints');
  const cache = workflowStep(ciWorkflow, 'Cache production app DerivedData');
  const prepare = workflowStep(ciWorkflow, 'Prepare production app DerivedData cache');
  const pods = workflowStep(ciWorkflow, 'Install app CocoaPods dependencies');
  const build = workflowStep(ciWorkflow, 'Build the iOS Simulator app');
  const writeManifest = workflowStep(ciWorkflow, 'Write production app DerivedData manifest');
  const oauthTests = workflowStep(ciWorkflow, 'Test the standalone ChatGPT OAuth package');
  const oauthBuild = workflowStep(
    ciWorkflow,
    'Build the standalone ChatGPT OAuth Simulator harness',
  );
  const indices = [
    ciWorkflow.indexOf('- name: Compute production app cache fingerprints'),
    ciWorkflow.indexOf('- name: Cache production app DerivedData'),
    ciWorkflow.indexOf('- name: Prepare production app DerivedData cache'),
    ciWorkflow.indexOf('- name: Install app CocoaPods dependencies'),
    ciWorkflow.indexOf('- name: Build the iOS Simulator app'),
  ];
  assert.ok(
    indices.every(
      (index, position) => index >= 0 && (position === 0 || index > indices[position - 1]),
    ),
  );
  assert.match(fingerprint, /--derived-data-only/);
  assert.match(cache, /path: apps\/mobile\/ios\/build-production/);
  assert.match(prepare, /detox-derived-data-cache\.mjs prepare production/);
  for (const step of [prepare, writeManifest]) {
    assert.match(
      step,
      /set -o pipefail; node scripts\/ci\/detox-derived-data-cache\.mjs[^\n]*\| tee/,
    );
  }
  assert.match(pods, /app_reusable != 'true'/);
  assert.match(build, /app_reusable != 'true'/);
  assert.doesNotMatch(oauthTests, /if:/);
  assert.doesNotMatch(oauthBuild, /if:/);
  assert.match(mobilePackage, /"ios:build"[\s\S]*?ios\/build/);
});

test('production build uses its separate DerivedData path', () => {
  const root = createFixtureRepository();
  const capturePath = join(root, 'xcodebuild-args.txt');
  const xcodebuild = join(root, 'bin/xcodebuild');
  const scriptPath = join(repositoryRoot, 'scripts/ci/build-ios-simulator-app.sh');
  try {
    writeFixtureFile(
      root,
      'bin/xcodebuild',
      ['#!/bin/sh', 'printf "%s\\n" "$@" > "$OROT_XCODEBUILD_ARGS"'].join('\n') + '\n',
    );
    chmodSync(xcodebuild, 0o755);
    execFileSync('bash', [scriptPath, 'build'], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        PATH: join(root, 'bin') + ':' + process.env.PATH,
        OROT_XCODEBUILD_ARGS: capturePath,
      },
    });
    const args = readFileSync(capturePath, 'utf8');
    assert.ok(args.includes('-derivedDataPath\napps/mobile/ios/build-production'));
    assert.ok(args.includes('-workspace\napps/mobile/ios/OrotMobile.xcworkspace'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
