import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const recordScript = join(repositoryRoot, 'scripts/ci/record-detox-cache-state.sh');
const hostArchitecture = spawnSync('uname', ['-m'], { encoding: 'utf8' }).stdout.trim();

test('records cache decisions and toolchain provenance in one CI artifact', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-detox-cache-state-'));
  const outputPath = join(directory, 'artifacts/detox/native-cache.log');
  try {
    const result = spawnSync('bash', [recordScript, outputPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        DETOX_PROFILE: 'transcription',
        DETOX_FRAMEWORK_CACHE_HIT: 'true',
        DERIVED_DATA_CACHE_CLASSIFICATION: 'dependency-compatible',
        APP_REUSABLE: 'false',
        APP_REUSE_REASON: 'native build inputs changed',
        PRIVACY_MANIFEST_INPUT_SHA256: 'privacy-hash',
        DERIVED_DATA_CACHE_DIAGNOSTIC: 'app outputs cleared',
        BUILD_INPUT_FINGERPRINT: 'build-hash',
        RN_ARTIFACT_FINGERPRINT: 'react-native-hash',
        NATIVE_DEPENDENCY_FINGERPRINT: 'native-hash',
        XCODEBUILD_FINGERPRINT: 'xcode-build-hash',
        EXPECTED_XCODE_VERSION: '26.2',
        EXPECTED_IOS_SIMULATOR_SDK: '26.2',
        EXPECTED_IOS_SIMULATOR_RUNTIME_NAME: 'iOS 26.2',
        EXPECTED_DETOX_SIMULATOR_DEVICE_TYPE_ID:
          'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro',
        MACOS_VERSION: '26.6.2',
        NODE_VERSION: '22.23.2',
        PNPM_VERSION: '12.3.4',
        RUBY_VERSION: '4.0.7',
        COCOAPODS_VERSION: '1.17.0',
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      readFileSync(outputPath, 'utf8'),
      [
        'profile=transcription',
        'detox_framework_cache_hit=true',
        'react_native_artifacts_cache_hit=false',
        'cocoapods_intermediates_cache_hit=false',
        'derived_data_cache_hit=false',
        'derived_data_cache_classification=dependency-compatible',
        'app_reusable=false',
        'app_reuse_reason=native build inputs changed',
        'privacy_manifest_input_sha256=privacy-hash',
        'derived_data_cache_diagnostic=app outputs cleared',
        'build_input_fingerprint=build-hash',
        'react_native_artifact_fingerprint=react-native-hash',
        'native_dependency_fingerprint=native-hash',
        'xcodebuild_fingerprint=xcode-build-hash',
        'xcode=26.2 ios_simulator_sdk=26.2 ios_simulator_runtime=iOS 26.2 ios_simulator_device_type=com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro',
        'macos=26.6.2',
        'node=22.23.2',
        'pnpm=12.3.4',
        'expected_ruby=4.0.7',
        'expected_cocoapods=1.17.0',
        `architecture=${hostArchitecture}`,
        '',
      ].join('\n'),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('requires an artifact destination instead of silently losing cache evidence', () => {
  const result = spawnSync('bash', [recordScript], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: .*record-detox-cache-state\.sh <output-path>/);
});
