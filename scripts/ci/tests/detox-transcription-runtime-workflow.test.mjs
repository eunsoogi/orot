import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const profileWorkflow = readFileSync(
  join(repositoryRoot, '.github/workflows/detox-e2e-profile.yml'),
  'utf8',
);
const profileCachePreparationAction = readFileSync(
  join(repositoryRoot, '.github/actions/detox-profile-app-cache/prepare/action.yml'),
  'utf8',
);
const cacheStateRecorder = readFileSync(
  join(repositoryRoot, 'scripts/ci/record-detox-cache-state.sh'),
  'utf8',
);
const profileDependencySetup = readFileSync(
  join(repositoryRoot, 'scripts/ci/install-detox-profile-dependencies.sh'),
  'utf8',
);

function workflowStep(name) {
  const start = profileWorkflow.indexOf(`- name: ${name}`);
  const end = profileWorkflow.indexOf('\n      - name:', start + 1);
  return profileWorkflow.slice(start, end < 0 ? undefined : end);
}

test('builds with SDK 27 while isolating the measured transcription runtime', () => {
  const podsCache = workflowStep('Cache Detox CocoaPods intermediates');
  const appCache = workflowStep('Cache Detox profile app product');
  const cacheRecord = workflowStep('Record Detox cache state');
  const manifestWrite = workflowStep('Write Detox DerivedData cache manifest');
  const simulatorPreparation = workflowStep('Prepare dedicated Detox Simulator');
  const toolchainVerification = workflowStep('Verify runner toolchain');

  // Keep the configured build SDK independent from the transcription Simulator runtime.
  assert.match(profileWorkflow, /runs-on: xcode-27/);
  assert.match(profileWorkflow, /DEVELOPER_DIR: \/Applications\/Xcode\.app\/Contents\/Developer/);
  assert.match(profileWorkflow, /EXPECTED_XCODE_VERSION: '27\.0'/);
  assert.match(profileWorkflow, /EXPECTED_IOS_SIMULATOR_SDK: '27\.0'/);
  assert.doesNotMatch(profileWorkflow, /Xcode_26/);
  assert.doesNotMatch(profileWorkflow, /EXPECTED_MACOS_VERSION/);
  assert.match(toolchainVerification, /id: verify_toolchain/);
  assert.match(toolchainVerification, /timeout-minutes: 20/);
  assert.match(
    toolchainVerification,
    /prepare-detox-runtime\.sh[\s\S]*?&& scripts\/ci\/verify-toolchain\.sh/,
  );
  assert.match(
    profileDependencySetup,
    /if \[\[ "\$profile" == "transcription" \]\]; then[\s\S]*?run-command\.sh speech-readiness-regression[\s\S]*?run-readiness-regression\.sh/,
  );
  assert.ok(
    profileWorkflow.indexOf('- name: Verify runner toolchain') <
      profileWorkflow.indexOf('- name: Install dependencies and check Speech readiness') &&
      profileWorkflow.indexOf('- name: Install dependencies and check Speech readiness') <
        profileWorkflow.indexOf('- name: Prepare dedicated Detox Simulator'),
    'The readiness regression must run before the Simulator setup begins.',
  );
  for (const cacheStep of [podsCache, appCache]) {
    assert.match(
      cacheStep,
      /macos-\$\{\{\s*steps\.verify_toolchain\.outputs\.macos_version\s*\}\}/,
    );
  }
  assert.match(
    profileWorkflow,
    /EXPECTED_IOS_SIMULATOR_RUNTIME_NAME: \$\{\{ inputs\.profile == 'transcription' && 'iOS 26\.2' \|\| 'iOS 27\.0' \}\}/,
  );
  assert.match(
    profileWorkflow,
    /EXPECTED_IOS_SIMULATOR_RUNTIME_IDENTIFIER: \$\{\{ inputs\.profile == 'transcription' && 'com\.apple\.CoreSimulator\.SimRuntime\.iOS-26-2' \|\| 'com\.apple\.CoreSimulator\.SimRuntime\.iOS-27-0' \}\}/,
  );
  assert.match(
    profileWorkflow,
    /EXPECTED_DETOX_SIMULATOR_DEVICE_NAME: \$\{\{ inputs\.profile == 'transcription' && 'iPhone SE \(3rd generation\)' \|\| 'iPhone 18 Pro' \}\}/,
  );
  assert.match(
    profileWorkflow,
    /EXPECTED_DETOX_SIMULATOR_DEVICE_TYPE_ID: \$\{\{ inputs\.profile == 'transcription' && 'com\.apple\.CoreSimulator\.SimDeviceType\.iPhone-SE-3rd-generation' \|\| 'com\.apple\.CoreSimulator\.SimDeviceType\.iPhone-18-Pro' \}\}/,
  );
  assert.match(profileWorkflow, /DETOX_CACHE_RUNTIME_SUFFIX/);
  assert.match(profileWorkflow, /-runtime-ios26\.2-build23C54-device-iphonese3/);
  assert.match(podsCache, /DETOX_CACHE_RUNTIME_SUFFIX/);
  assert.match(
    appCache,
    /inputs\.profile\s*\}\}\$\{\{\s*env\.DETOX_CACHE_RUNTIME_SUFFIX\s*\}\}-native-/,
  );
  assert.match(cacheStateRecorder, /ios_simulator_runtime=/);
  assert.match(cacheStateRecorder, /ios_simulator_device_type=/);
  assert.match(
    cacheRecord,
    /MACOS_VERSION: \$\{\{\s*steps\.verify_toolchain\.outputs\.macos_version\s*\}\}/,
  );
  assert.match(
    profileCachePreparationAction,
    /node scripts\/ci\/detox-derived-data-cache\.mjs prepare/,
  );
  assert.match(
    profileCachePreparationAction,
    /MACOS_VERSION: \$\{\{ fromJSON\(inputs\.workflow_steps\)\.verify_toolchain\.outputs\.macos_version \}\}/,
  );
  assert.match(
    manifestWrite,
    /MACOS_VERSION: \$\{\{\s*steps\.verify_toolchain\.outputs\.macos_version\s*\}\}/,
  );
  assert.match(simulatorPreparation, /prepare-detox-simulator\.sh[\s\S]*?inputs\.profile/);
});
