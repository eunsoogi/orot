import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { computeDetoxCacheFingerprints } from '../detox-cache-fingerprint.mjs';
import {
  createFixtureRepository,
  runCacheCommand,
  writeFixtureFile,
} from './fixtures/detox-derived-data-cache.mjs';

const projectPath = 'apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj';
const privacyPath = 'apps/mobile/ios/OrotMobile/PrivacyInfo.xcprivacy';
const workflowPath = fileURLToPath(new URL('../../../.github/workflows/ci.yml', import.meta.url));
const detoxBuildPath = fileURLToPath(new URL('../build-detox-apps.sh', import.meta.url));
const productionBuildPath = fileURLToPath(
  new URL('../build-ios-simulator-app.sh', import.meta.url),
);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function prepareEnvironment(root, initial) {
  const runnerTemp = join(root, 'runner-temp');
  mkdirSync(runnerTemp, { recursive: true });
  return {
    RUNNER_TEMP: runnerTemp,
    EXPECTED_COCOAPODS_INPUT_HASHES_JSON: JSON.stringify({
      privacyManifest: initial.privacyManifestInputHash,
      projectFile: initial.cocoapodsProjectInputHash,
    }),
    EXPECTED_DETOX_BUILD_INPUT_FINGERPRINT: initial.buildInputs,
    EXPECTED_DETOX_NATIVE_DEPENDENCY_FINGERPRINT: initial.nativeDependencies,
  };
}

test('records post-Pods fingerprints and accepts the exact cached app on the next run', () => {
  const root = createFixtureRepository();
  const generatedProject = 'CocoaPods project integration';
  const generatedPrivacy = 'CocoaPods aggregated privacy reasons';

  try {
    writeFixtureFile(root, projectPath, generatedProject);
    writeFixtureFile(root, privacyPath, generatedPrivacy);
    const initial = computeDetoxCacheFingerprints(root);
    const environment = prepareEnvironment(root, initial);
    runCacheCommand(root, 'prepare', environment);
    assert.match(runCacheCommand(root, 'verify-build-inputs', environment), /post-pods-verified/);
    runCacheCommand(root, 'write', environment);

    const manifestPath = join(root, 'apps/mobile/ios/build-detox-release/.orot-detox-cache.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.deepEqual(manifest.cocoapodsInputProvenance, {
      baseline: {
        privacyManifest: sha256(generatedPrivacy),
        projectFile: sha256(generatedProject),
      },
      afterInstall: {
        privacyManifest: sha256(generatedPrivacy),
        projectFile: sha256(generatedProject),
      },
    });

    const cacheResult = runCacheCommand(root, 'prepare', environment);
    assert.match(cacheResult, /classification=exact/);
    assert.match(cacheResult, /app_reusable=true/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('invalidates cached provenance when either post-Pods digest is corrupted', () => {
  const root = createFixtureRepository();

  try {
    writeFixtureFile(root, projectPath, 'CocoaPods project integration');
    writeFixtureFile(root, privacyPath, 'CocoaPods aggregated privacy reasons');
    const initial = computeDetoxCacheFingerprints(root);
    const environment = prepareEnvironment(root, initial);
    runCacheCommand(root, 'prepare', environment);
    runCacheCommand(root, 'verify-build-inputs', environment);
    runCacheCommand(root, 'write', environment);

    const derivedData = join(root, 'apps/mobile/ios/build-detox-release');
    const manifestPath = join(derivedData, '.orot-detox-cache.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.cocoapodsInputProvenance.afterInstall.projectFile = '0'.repeat(64);
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const result = runCacheCommand(root, 'prepare', environment);
    assert.match(result, /classification=invalidated/);
    assert.match(result, /cocoapods_input_provenance\.after_install/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fails closed when a PBX source edit occurs after fingerprinting but before cache lookup', () => {
  const root = createFixtureRepository();

  try {
    writeFixtureFile(root, projectPath, 'CocoaPods project integration');
    writeFixtureFile(root, privacyPath, 'CocoaPods aggregated privacy reasons');
    const initial = computeDetoxCacheFingerprints(root);
    const environment = prepareEnvironment(root, initial);
    const derivedData = join(root, 'apps/mobile/ios/build-detox-release');
    mkdirSync(derivedData, { recursive: true });
    writeFixtureFile(root, projectPath, 'source edit after initial fingerprint');

    assert.throws(
      () => runCacheCommand(root, 'prepare', environment),
      /CocoaPods input hashes changed before cache lookup: projectFile/,
    );
    assert.equal(existsSync(derivedData), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a symlinked CocoaPods project input without following its target', () => {
  const root = createFixtureRepository();

  try {
    writeFixtureFile(root, 'external-project.pbxproj', 'outside source');
    unlinkSync(join(root, projectPath));
    symlinkSync(join(root, 'external-project.pbxproj'), join(root, projectPath));

    assert.throws(
      () => computeDetoxCacheFingerprints(root),
      /Refusing to normalize a symlinked CocoaPods build input: apps\/mobile\/ios\/OrotMobile\.xcodeproj\/project\.pbxproj/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects unrelated lockfile drift after cache preparation', () => {
  const root = createFixtureRepository();

  try {
    writeFixtureFile(root, projectPath, 'CocoaPods project integration');
    writeFixtureFile(root, privacyPath, 'CocoaPods aggregated privacy reasons');
    const initial = computeDetoxCacheFingerprints(root);
    const environment = prepareEnvironment(root, initial);
    runCacheCommand(root, 'prepare', environment);
    writeFixtureFile(root, 'apps/mobile/ios/Podfile.lock', 'changed after cache preparation');

    assert.throws(
      () => runCacheCommand(root, 'verify-build-inputs', environment),
      /unexpected build-input changes after CocoaPods install/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects changes to CocoaPods outputs after pre-build verification', () => {
  const root = createFixtureRepository();

  try {
    writeFixtureFile(root, projectPath, 'CocoaPods project integration');
    writeFixtureFile(root, privacyPath, 'CocoaPods aggregated privacy reasons');
    const initial = computeDetoxCacheFingerprints(root);
    const environment = prepareEnvironment(root, initial);
    runCacheCommand(root, 'prepare', environment);
    writeFixtureFile(root, projectPath, 'CocoaPods project integration');
    writeFixtureFile(root, privacyPath, 'CocoaPods aggregated privacy reasons');
    runCacheCommand(root, 'verify-build-inputs', environment);
    writeFixtureFile(root, projectPath, 'project changed after build verification');

    assert.throws(
      () => runCacheCommand(root, 'write', environment),
      /CocoaPods input hashes changed after build-input verification and before manifest write: projectFile/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('calls build-input verification before both production and Detox native builds', () => {
  const production = readFileSync(productionBuildPath, 'utf8');
  const detox = readFileSync(detoxBuildPath, 'utf8');
  const workflow = readFileSync(workflowPath, 'utf8');

  assert.match(production, /detox-derived-data-cache\.mjs verify-build-inputs production/);
  assert.match(detox, /detox-derived-data-cache\.mjs verify-build-inputs "\$profile"/);
  assert.match(workflow, /EXPECTED_DETOX_BUILD_INPUT_FINGERPRINT/);
});
