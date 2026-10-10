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
const workflowPath = fileURLToPath(
  new URL('../../../.github/workflows/e2e-test.yml', import.meta.url),
);
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

// Keep temporary repositories isolated and remove them even when an assertion fails.
function testWithFixtureRepository(name, run) {
  test(name, () => {
    const root = createFixtureRepository();
    try {
      run(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

testWithFixtureRepository(
  'keys app caches from pre-Pods inputs and preserves the post-install integration digest',
  (root) => {
    const sourceProject = readFileSync(join(root, projectPath), 'utf8');
    const sourcePrivacy = readFileSync(join(root, privacyPath), 'utf8');
    const generatedProject = 'CocoaPods project integration';
    const generatedPrivacy = 'CocoaPods aggregated privacy reasons';

    const initial = computeDetoxCacheFingerprints(root);
    const environment = prepareEnvironment(root, initial);
    runCacheCommand(root, 'prepare', environment);
    writeFixtureFile(root, projectPath, generatedProject);
    writeFixtureFile(root, privacyPath, generatedPrivacy);
    assert.match(runCacheCommand(root, 'verify-build-inputs', environment), /post-pods-verified/);
    runCacheCommand(root, 'write', environment);

    const manifestPath = join(root, 'apps/mobile/ios/build-detox-release/.orot-detox-cache.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.deepEqual(manifest.cocoapodsInputProvenance, {
      baseline: {
        privacyManifest: sha256(sourcePrivacy),
        projectFile: sha256(sourceProject),
      },
      afterInstall: {
        privacyManifest: sha256(generatedPrivacy),
        projectFile: sha256(generatedProject),
      },
    });

    // A later workflow starts from the checked-out source while reusing the installed build output.
    writeFixtureFile(root, projectPath, sourceProject);
    writeFixtureFile(root, privacyPath, sourcePrivacy);
    const cacheResult = runCacheCommand(root, 'prepare', environment);
    assert.match(cacheResult, /classification=exact/);
    assert.match(cacheResult, /app_reusable=true/);
  },
);

testWithFixtureRepository(
  'falls back to the build path when an exact app cache is missing a Detox framework artifact',
  (root) => {
    const frameworkBinary = join(root, 'detox-framework/framework/Detox.framework/Detox');

    const derivedData = join(root, 'apps/mobile/ios/build-detox-release');
    const appProduct = join(derivedData, 'Build/Products/Release-iphonesimulator/Orot.app');
    mkdirSync(derivedData, { recursive: true });
    runCacheCommand(root, 'write');
    writeFileSync(frameworkBinary, 'corrupted-framework');

    const output = runCacheCommand(root, 'prepare');
    assert.match(output, /classification=exact/);
    assert.match(output, /app_reusable=false/);
    assert.match(output, /app_reuse_reason=detox_artifact_digest_mismatch/);
    assert.equal(existsSync(appProduct), false);
    assert.equal(existsSync(join(root, 'detox-framework/framework')), false);
    assert.equal(existsSync(join(root, 'detox-framework/xcuitest-runner')), false);
  },
);

testWithFixtureRepository(
  'does not reuse legacy app manifests without a Detox artifact fingerprint',
  (root) => {
    const derivedData = join(root, 'apps/mobile/ios/build-detox-release');
    const appProduct = join(derivedData, 'Build/Products/Release-iphonesimulator/Orot.app');
    const manifestPath = join(derivedData, '.orot-detox-cache.json');

    mkdirSync(derivedData, { recursive: true });
    runCacheCommand(root, 'write');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    delete manifest.detoxArtifacts;
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const output = runCacheCommand(root, 'prepare');
    assert.match(output, /app_reusable=false/);
    assert.match(output, /app_reuse_reason=detox_artifact_manifest_missing/);
    assert.equal(existsSync(appProduct), false);
    assert.equal(existsSync(join(root, 'detox-framework/framework')), false);
    assert.equal(existsSync(join(root, 'detox-framework/xcuitest-runner')), false);
  },
);

testWithFixtureRepository(
  'invalidates cached provenance when a recorded post-Pods digest is malformed',
  (root) => {
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
    manifest.cocoapodsInputProvenance.afterInstall.projectFile = 'not-a-sha256-digest';
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const result = runCacheCommand(root, 'prepare', environment);
    assert.match(result, /classification=invalidated/);
    assert.match(result, /cocoapods_input_provenance\.after_install_format/);
  },
);

testWithFixtureRepository(
  'fails closed when a PBX source edit occurs after fingerprinting but before cache lookup',
  (root) => {
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
  },
);

testWithFixtureRepository(
  'rejects a symlinked CocoaPods project input without following its target',
  (root) => {
    writeFixtureFile(root, 'external-project.pbxproj', 'outside source');
    unlinkSync(join(root, projectPath));
    symlinkSync(join(root, 'external-project.pbxproj'), join(root, projectPath));

    assert.throws(
      () => computeDetoxCacheFingerprints(root),
      /Refusing to normalize a symlinked CocoaPods build input: apps\/mobile\/ios\/OrotMobile\.xcodeproj\/project\.pbxproj/,
    );
  },
);

testWithFixtureRepository('rejects unrelated lockfile drift after cache preparation', (root) => {
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
});

testWithFixtureRepository(
  'rejects changes to CocoaPods outputs after pre-build verification',
  (root) => {
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
  },
);

test('calls build-input verification before both production and Detox native builds', () => {
  const production = readFileSync(productionBuildPath, 'utf8');
  const detox = readFileSync(detoxBuildPath, 'utf8');

  assert.match(production, /detox-derived-data-cache\.mjs verify-build-inputs production/);
  assert.match(detox, /detox-derived-data-cache\.mjs verify-build-inputs "\$profile"/);
  assert.match(readFileSync(workflowPath, 'utf8'), /EXPECTED_DETOX_BUILD_INPUT_FINGERPRINT/);
});
