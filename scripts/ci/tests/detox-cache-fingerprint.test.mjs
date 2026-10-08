import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { computeDetoxCacheFingerprints } from '../detox-cache-fingerprint.mjs';
import { writeDetoxBuildConfigs } from './fixtures/detox-derived-data-cache.mjs';

const fingerprintScriptPath = fileURLToPath(
  new URL('../detox-cache-fingerprint-cli.mjs', import.meta.url),
);

function writeFixtureFile(root, path, content) {
  const absolutePath = join(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

function git(root, ...args) {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}

test('keeps CocoaPods source inputs fingerprinted across generated integration changes', () => {
  const root = mkdtempSync(join(tmpdir(), 'orot-detox-cache-fingerprint-'));
  try {
    git(root, 'init', '-q');
    for (const path of [
      '.github/workflows/ci.yml',
      '.github/workflows/detox-e2e-profile.yml',
      '.npmrc',
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'apps/mobile/App.tsx',
      'apps/mobile/ios/Podfile.lock',
      'apps/mobile/ios/OrotMobile/PrivacyInfo.xcprivacy',
      'apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj',
      'packages/storage/src/index.ts',
      'scripts/ci/build-detox-apps.sh',
      'scripts/ci/build-ios-simulator-app.sh',
      'scripts/ci/detox-cache-fingerprint.mjs',
      'scripts/ci/detox-cache-fingerprint-cli.mjs',
      'scripts/ci/detox-derived-data-cache.mjs',
      'scripts/ci/run-detox-e2e.sh',
      'scripts/ci/detox-e2e-profile.detox.config.cjs',
      'scripts/ci/detox-e2e-profile.jest.config.cjs',
      'apps/mobile/ios/build-detox-release/DerivedData.db',
      'apps/mobile/ios/build-detox-openai-provider/DerivedData.db',
      'apps/mobile/ios/build-detox-transcription/DerivedData.db',
      'apps/mobile/ios/build-agent-memory/DerivedData.db',
      'apps/mobile/ios/build/generated/ios/ReactCodegen/ReactCodegen.xcconfig',
      'apps/mobile/ios/Pods/Pods.xcodeproj/project.pbxproj',
      'apps/mobile/node_modules/generated.js',
      'packages/storage/node_modules/generated.js',
      'apps/mobile/.cache/generated.js',
      'apps/mobile/ios/CoreSimulator/devices/generated.plist',
      'apps/mobile/ios/Simulator/devices/generated.plist',
      'apps/mobile/ios/Keychains/login.keychain',
    ]) {
      writeFixtureFile(root, path, `initial:${path}`);
    }
    writeDetoxBuildConfigs(root);
    git(root, 'add', '--all');

    const initial = computeDetoxCacheFingerprints(root);

    const privacyManifestInputHash = initial.privacyManifestInputHash;
    const cocoapodsProjectInputHash = initial.cocoapodsProjectInputHash;
    writeFixtureFile(
      root,
      'apps/mobile/ios/OrotMobile/PrivacyInfo.xcprivacy',
      'CocoaPods aggregated privacy reasons',
    );
    writeFixtureFile(
      root,
      'apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj',
      'CocoaPods generated project integration',
    );
    const postInstallFingerprint = computeDetoxCacheFingerprints(root);
    assert.notEqual(postInstallFingerprint.buildInputs, initial.buildInputs);
    assert.notEqual(postInstallFingerprint.nativeDependencies, initial.nativeDependencies);
    assert.notEqual(postInstallFingerprint.privacyManifestInputHash, privacyManifestInputHash);
    assert.notEqual(postInstallFingerprint.cocoapodsProjectInputHash, cocoapodsProjectInputHash);
    // Cache inputs keep the checked-out source baseline separate from generated integration files.
    const sourceBaselineFingerprint = computeDetoxCacheFingerprints(root, {
      privacyManifestInputHash,
      cocoapodsProjectInputHash,
    });
    assert.deepEqual(sourceBaselineFingerprint, initial);
    assert.notEqual(
      computeDetoxCacheFingerprints(root, { privacyManifestInputHash }).buildInputs,
      initial.buildInputs,
    );
    writeFixtureFile(
      root,
      'apps/mobile/ios/OrotMobile/PrivacyInfo.xcprivacy',
      'unstaged source edit before cache lookup',
    );
    const afterUnstagedSourceEdit = computeDetoxCacheFingerprints(root);
    assert.notEqual(afterUnstagedSourceEdit.buildInputs, initial.buildInputs);
    assert.notEqual(afterUnstagedSourceEdit.nativeDependencies, initial.nativeDependencies);
    writeFixtureFile(
      root,
      'apps/mobile/ios/OrotMobile/PrivacyInfo.xcprivacy',
      'initial:apps/mobile/ios/OrotMobile/PrivacyInfo.xcprivacy',
    );
    writeFixtureFile(
      root,
      'apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj',
      'initial:apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj',
    );

    const outputPath = join(root, 'github-output.txt');
    const environmentPath = join(root, 'github-environment.txt');
    execFileSync('node', [fingerprintScriptPath], {
      cwd: root,
      env: { ...process.env, GITHUB_ENV: environmentPath, GITHUB_OUTPUT: outputPath },
      encoding: 'utf8',
    });
    assert.equal(
      readFileSync(outputPath, 'utf8'),
      `build_inputs=${initial.buildInputs}\nbuild_input_count=${initial.buildInputCount}\nreact_native_artifacts=${initial.reactNativeArtifacts}\nnative_dependencies=${initial.nativeDependencies}\nnative_dependency_input_count=${initial.nativeDependencyInputCount}\nprivacy_manifest_input_sha256=${initial.privacyManifestInputHash}\ncocoapods_project_input_sha256=${initial.cocoapodsProjectInputHash}\n`,
    );
    assert.equal(
      readFileSync(environmentPath, 'utf8'),
      `EXPECTED_COCOAPODS_INPUT_HASHES_JSON={"privacyManifest":"${initial.privacyManifestInputHash}","projectFile":"${initial.cocoapodsProjectInputHash}"}\nEXPECTED_DETOX_BUILD_INPUT_FINGERPRINT=${initial.buildInputs}\nEXPECTED_DETOX_NATIVE_DEPENDENCY_FINGERPRINT=${initial.nativeDependencies}\n`,
    );

    for (const [mode, output, expected] of [
      [
        '--react-native-artifacts-only',
        join(root, 'react-native-output.txt'),
        `react_native_artifacts=${initial.reactNativeArtifacts}\n`,
      ],
      [
        '--derived-data-only',
        join(root, 'derived-data-output.txt'),
        `build_inputs=${initial.buildInputs}\nbuild_input_count=${initial.buildInputCount}\nnative_dependencies=${initial.nativeDependencies}\nnative_dependency_input_count=${initial.nativeDependencyInputCount}\nprivacy_manifest_input_sha256=${initial.privacyManifestInputHash}\ncocoapods_project_input_sha256=${initial.cocoapodsProjectInputHash}\n`,
      ],
    ]) {
      execFileSync('node', [fingerprintScriptPath, mode], {
        cwd: root,
        env: { ...process.env, GITHUB_OUTPUT: output },
        encoding: 'utf8',
      });
      assert.equal(readFileSync(output, 'utf8'), expected);
    }

    for (const path of [
      'apps/mobile/ios/build-detox-release/DerivedData.db',
      'apps/mobile/ios/build-detox-openai-provider/DerivedData.db',
      'apps/mobile/ios/build-detox-transcription/DerivedData.db',
      'apps/mobile/ios/build-agent-memory/DerivedData.db',
      'apps/mobile/ios/build/generated/ios/ReactCodegen/ReactCodegen.xcconfig',
      'apps/mobile/ios/Pods/Pods.xcodeproj/project.pbxproj',
      'apps/mobile/node_modules/generated.js',
      'packages/storage/node_modules/generated.js',
      'apps/mobile/.cache/generated.js',
      'apps/mobile/ios/CoreSimulator/devices/generated.plist',
      'apps/mobile/ios/Simulator/devices/generated.plist',
      'apps/mobile/ios/Keychains/login.keychain',
    ]) {
      writeFixtureFile(root, path, 'changed generated output');
    }
    git(root, 'add', '--all');
    const afterGeneratedOutputs = computeDetoxCacheFingerprints(root);

    assert.deepEqual(afterGeneratedOutputs, initial);

    writeFixtureFile(root, 'scripts/ci/run-detox-e2e.sh', 'changed Detox invocation wrapper');
    writeFixtureFile(
      root,
      'scripts/ci/detox-e2e-profile.detox.config.cjs',
      'changed Detox test-runner config',
    );
    writeFixtureFile(
      root,
      'scripts/ci/detox-e2e-profile.jest.config.cjs',
      'changed Jest-only profile config',
    );
    git(root, 'add', '--all');
    const afterTestRunnerConfigChanges = computeDetoxCacheFingerprints(root);

    assert.deepEqual(afterTestRunnerConfigChanges, initial);

    writeFixtureFile(
      root,
      'apps/mobile/.detoxrc.js',
      `// formatting-only change\n${readFileSync(join(root, 'apps/mobile/.detoxrc.js'), 'utf8')}`,
    );
    git(root, 'add', '--all');
    const afterDetoxConfigFormattingChange = computeDetoxCacheFingerprints(root);
    assert.notEqual(afterDetoxConfigFormattingChange.buildInputs, initial.buildInputs);
    assert.equal(afterDetoxConfigFormattingChange.nativeDependencies, initial.nativeDependencies);

    writeFixtureFile(
      root,
      'apps/mobile/.detoxrc.js',
      readFileSync(join(root, 'apps/mobile/.detoxrc.js'), 'utf8').replace(
        'ENTRY_FILE=e2e/e2eRouterEntry.tsx',
        'ENTRY_FILE=e2e/checkpointProbeEntry.tsx',
      ),
    );
    git(root, 'add', '--all');
    const afterJavaScriptEntryChange = computeDetoxCacheFingerprints(root);
    assert.notEqual(afterJavaScriptEntryChange.buildInputs, initial.buildInputs);
    assert.equal(afterJavaScriptEntryChange.nativeDependencies, initial.nativeDependencies);

    writeFixtureFile(root, 'apps/mobile/App.tsx', 'changed tracked app source');
    git(root, 'add', '--all');
    const afterAppSourceChange = computeDetoxCacheFingerprints(root);
    assert.notEqual(afterAppSourceChange.buildInputs, initial.buildInputs);
    assert.equal(afterAppSourceChange.reactNativeArtifacts, initial.reactNativeArtifacts);
    assert.equal(afterAppSourceChange.nativeDependencies, initial.nativeDependencies);

    writeFixtureFile(
      root,
      'apps/mobile/.detoxrc.js',
      readFileSync(join(root, 'apps/mobile/.detoxrc.js'), 'utf8').replace(
        '-derivedDataPath ios/build-detox-release',
        '-derivedDataPath ios/build-detox-release-v2',
      ),
    );
    git(root, 'add', '--all');
    const afterBuildConfigurationChange = computeDetoxCacheFingerprints(root);
    assert.notEqual(afterBuildConfigurationChange.nativeDependencies, initial.nativeDependencies);

    writeFixtureFile(root, 'apps/mobile/ios/Podfile.lock', 'changed CocoaPods lock');
    git(root, 'add', '--all');
    const afterLockChange = computeDetoxCacheFingerprints(root);
    for (const [actual, previous] of [
      [afterLockChange.buildInputs, afterAppSourceChange.buildInputs],
      [afterLockChange.reactNativeArtifacts, afterAppSourceChange.reactNativeArtifacts],
      [afterLockChange.nativeDependencies, afterBuildConfigurationChange.nativeDependencies],
    ]) {
      assert.notEqual(actual, previous);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
