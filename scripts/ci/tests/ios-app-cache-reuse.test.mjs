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
  const cache = workflowStep(profileWorkflow, 'Cache Detox profile app product');
  const pods = workflowStep(profileWorkflow, 'Install Detox CocoaPods dependencies');
  const build = workflowStep(profileWorkflow, 'Build Detox iOS Simulator app');
  const testRun = workflowStep(profileWorkflow, 'Run Detox iOS Simulator tests');
  const fingerprintIndex = profileWorkflow.indexOf(
    '- name: Compute stable Detox cache fingerprints',
  );
  const cacheIndex = profileWorkflow.indexOf('- name: Cache Detox profile app product');
  const prepareIndex = profileWorkflow.indexOf('- name: Prepare restored Detox DerivedData cache');
  const podsIndex = profileWorkflow.indexOf('- name: Install Detox CocoaPods dependencies');
  assert.ok(podsIndex >= 0 && fingerprintIndex < cacheIndex && cacheIndex < prepareIndex);
  assert.ok(prepareIndex < podsIndex);
  assert.match(
    cache,
    /apps\/mobile\/ios\/build-detox-\$\{\{ inputs\.profile \}\}\/\.orot-detox-cache\.json/,
  );
  assert.match(
    cache,
    /apps\/mobile\/ios\/build-detox-\$\{\{ inputs\.profile \}\}\/Build\/Products/,
  );
  assert.match(cache, /~\/Library\/Detox\/ios\/framework/);
  assert.match(cache, /~\/Library\/Detox\/ios\/xcuitest-runner/);
  assert.doesNotMatch(cache, /Build\/Intermediates|Index\.noIndex|Logs/);
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
  const cache = workflowStep(ciWorkflow, 'Cache production app DerivedData and CocoaPods');
  const prepare = workflowStep(ciWorkflow, 'Prepare production app DerivedData cache');
  const pods = workflowStep(ciWorkflow, 'Install app CocoaPods dependencies');
  const build = workflowStep(ciWorkflow, 'Build the iOS Simulator app');
  const writeManifest = workflowStep(ciWorkflow, 'Write production app DerivedData manifest');
  const signingAndOAuth = workflowStep(
    ciWorkflow,
    'Verify Simulator defaults and test OAuth package',
  );
  const oauthBuild = workflowStep(
    ciWorkflow,
    'Build the standalone ChatGPT OAuth Simulator harness',
  );
  assert.doesNotMatch(ciWorkflow, /EXPECTED_MACOS_VERSION/);
  const indices = [
    ciWorkflow.indexOf('- name: Compute production app cache fingerprints'),
    ciWorkflow.indexOf('- name: Cache production app DerivedData and CocoaPods'),
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
  assert.match(
    cache,
    /path:\s+\|\n\s+apps\/mobile\/ios\/build-production\n\s+apps\/mobile\/ios\/Pods/,
  );
  assert.match(cache, /key: orot-ios-app-deriveddata-v5-/);
  assert.match(cache, /restore-keys: orot-ios-app-deriveddata-v5-/);
  assert.match(
    cache,
    /key:.*macos-\$\{\{\s*steps\.verify_toolchain\.outputs\.macos_version\s*\}\}/,
  );
  assert.match(
    cache,
    /restore-keys:.*macos-\$\{\{\s*steps\.verify_toolchain\.outputs\.macos_version\s*\}\}/,
  );
  assert.match(
    cache,
    /restore-keys:.*-xcode-\$\{\{\s*env\.EXPECTED_XCODE_VERSION\s*\}\}-build-\$\{\{\s*steps\.verify_toolchain\.outputs\.xcodebuild_fingerprint\s*\}\}/,
  );
  assert.match(
    prepare,
    /MACOS_VERSION: \$\{\{\s*steps\.verify_toolchain\.outputs\.macos_version\s*\}\}/,
  );
  assert.match(
    writeManifest,
    /MACOS_VERSION: \$\{\{\s*steps\.verify_toolchain\.outputs\.macos_version\s*\}\}/,
  );
  assert.match(cache, /xcodebuild_fingerprint/);
  assert.ok(
    ciWorkflow.indexOf('- name: Verify runner toolchain') <
      ciWorkflow.indexOf('- name: Prepare production app DerivedData cache'),
  );
  assert.match(
    ciWorkflow,
    /- name: Verify runner toolchain\s+id: verify_toolchain\s+run: scripts\/ci\/verify-toolchain\.sh --cocoapods/,
  );
  assert.doesNotMatch(prepare, /XCODEBUILD_FINGERPRINT:/);
  assert.doesNotMatch(writeManifest, /XCODEBUILD_FINGERPRINT:/);
  assert.match(prepare, /detox-derived-data-cache\.mjs prepare production/);
  for (const step of [prepare, writeManifest]) {
    assert.match(
      step,
      /set -o pipefail; node scripts\/ci\/detox-derived-data-cache\.mjs[^\n]*\| tee/,
    );
  }
  assert.match(pods, /app_reusable != 'true'/);
  assert.match(build, /app_reusable != 'true'/);
  // This must remain unconditional because production cache hits skip native builds.
  assert.doesNotMatch(signingAndOAuth, /if:/);
  assert.match(signingAndOAuth, /node scripts\/ci\/verify-simulator-keychain-defaults\.mjs &&/);
  assert.match(signingAndOAuth, /run-command\.sh openai-oauth-tests/);
  assert.doesNotMatch(oauthBuild, /if:/);
  assert.match(mobilePackage, /"ios:build"[\s\S]*?ios\/build/);
});

test('production build uses isolated DerivedData and the cache-compatible host architecture', () => {
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
        // This stub exercises the local build path; GitHub Actions provenance has separate tests.
        GITHUB_ACTIONS: 'false',
        PATH: join(root, 'bin') + ':' + process.env.PATH,
        OROT_XCODEBUILD_ARGS: capturePath,
      },
    });
    const args = readFileSync(capturePath, 'utf8');
    const hostArchitecture = execFileSync('uname', ['-m'], { encoding: 'utf8' }).trim();
    assert.ok(args.includes('-derivedDataPath\napps/mobile/ios/build-production'));
    assert.ok(args.includes('-workspace\napps/mobile/ios/OrotMobile.xcworkspace'));
    assert.ok(args.includes(`ARCHS=${hostArchitecture}`));
    assert.ok(args.includes('ONLY_ACTIVE_ARCH=YES'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
