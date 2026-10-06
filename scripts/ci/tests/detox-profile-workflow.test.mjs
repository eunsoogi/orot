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
const profilesWorkflow = readFileSync(
  join(repositoryRoot, '.github/workflows/detox-e2e-profiles.yml'),
  'utf8',
);
const ciWorkflow = readFileSync(join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8');
const runner = readFileSync(join(repositoryRoot, 'scripts/ci/run-detox-e2e.sh'), 'utf8');
const cacheStateRecorder = readFileSync(
  join(repositoryRoot, 'scripts/ci/record-detox-cache-state.sh'),
  'utf8',
);

function workflowStep(name) {
  const start = profileWorkflow.indexOf(`- name: ${name}`);
  const end = profileWorkflow.indexOf('\n      - name:', start + 1);
  return start < 0 ? '' : profileWorkflow.slice(start, end < 0 ? undefined : end);
}

test('keeps profile build, Simulator lifecycle, E2E, failure diagnostics, cleanup and upload in order', () => {
  const pods = profileWorkflow.indexOf('- name: Install Detox CocoaPods dependencies');
  const simulatorUtilities = profileWorkflow.indexOf('- name: Install Detox Simulator utilities');
  const nodeSetup = profileWorkflow.indexOf('- name: Set up Node.js');
  const rubySetup = profileWorkflow.indexOf('- name: Set up Ruby');
  const build = profileWorkflow.indexOf('- name: Build Detox iOS Simulator app');
  const prepare = profileWorkflow.indexOf('- name: Prepare dedicated Detox Simulator');
  const boot = profileWorkflow.indexOf('- name: Wait for dedicated Detox Simulator');
  const tests = profileWorkflow.indexOf('- name: Run Detox iOS Simulator tests');
  const diagnostics = profileWorkflow.indexOf('- name: Collect simulator logs');
  const teardown = profileWorkflow.indexOf('- name: Delete dedicated Detox Simulator');
  const upload = profileWorkflow.indexOf(
    '- name: Upload Detox reports, logs, screenshots, and videos',
  );
  const testStepStart = profileWorkflow.indexOf('- name: Run Detox iOS Simulator tests');
  const testStepEnd = profileWorkflow.indexOf('\n      - name:', testStepStart + 1);
  const testStep = profileWorkflow.slice(testStepStart, testStepEnd);
  const prepareStep = workflowStep('Prepare dedicated Detox Simulator');
  const teardownStep = workflowStep('Delete dedicated Detox Simulator');

  // Start boot after pinned Node, then overlap it with remaining toolchain and dependency setup.
  assert.ok(
    nodeSetup >= 0 &&
      nodeSetup < prepare &&
      prepare < rubySetup &&
      rubySetup < pods &&
      pods < simulatorUtilities &&
      simulatorUtilities < build &&
      build > prepare &&
      boot > build &&
      tests > boot,
  );
  assert.ok(diagnostics > tests && teardown > diagnostics && upload > teardown);
  assert.match(prepareStep, /id: prepare_detox_simulator/);
  assert.match(prepareStep, /artifacts\/detox\/simulator\.udid/);
  assert.match(teardownStep, /if: \$\{\{ always\(\) \}\}/);
  assert.match(
    teardownStep,
    /if \[\[ ! -s artifacts\/detox\/simulator\.udid \]\][\s\S]*?cat artifacts\/detox\/simulator\.udid/,
  );
  assert.match(testStep, /timeout-minutes: 45/);
  assert.match(testStep, /run:.*scripts\/ci\/run-test-suite\.sh/);
  assert.match(profileWorkflow, /if: \$\{\{ always\(\) \}\}/);
  assert.doesNotMatch(profileWorkflow, /mdutil|Spotlight|spotlight/i);
  assert.doesNotMatch(ciWorkflow, /mdutil|Spotlight|spotlight/i);
});

test('leaves heavy resource sampling off unless a manual run requests it and caps samples', () => {
  assert.match(
    ciWorkflow,
    /workflow_dispatch:[\s\S]*?detox_resource_sampling:[\s\S]*?type: boolean[\s\S]*?default: false/,
  );
  assert.match(
    ciWorkflow,
    /if \[\[ "\$GITHUB_EVENT_NAME" == workflow_dispatch \]\]; then[\s\S]*?scripts\/ci\/check-loc\.mjs --all[\s\S]*?else[\s\S]*?scripts\/ci\/check-loc\.mjs --base "\$LOC_BASE_SHA"/,
  );
  assert.match(
    profilesWorkflow,
    /resource_sampling:[\s\S]*?required: false[\s\S]*?type: boolean[\s\S]*?default: false/,
  );
  assert.match(profilesWorkflow, /resource_sampling: \$\{\{ inputs\.resource_sampling \}\}/);
  assert.match(
    profileWorkflow,
    /OROT_DETOX_RESOURCE_SAMPLING: \$\{\{ inputs\.resource_sampling \}\}/,
  );
  assert.match(runner, /resource_sample_limit=4/);
  assert.match(runner, /sample_index < resource_sample_limit/);
});

test('keys post-Pods app outputs and reuses only a validated exact DerivedData cache', () => {
  const fingerprintSource = readFileSync(
    join(repositoryRoot, 'scripts/ci/detox-cache-fingerprint.mjs'),
    'utf8',
  );
  const getStep = (name) => {
    const start = profileWorkflow.indexOf(`- name: ${name}`);
    const end = profileWorkflow.indexOf('\n      - name:', start + 1);
    return profileWorkflow.slice(start, end < 0 ? undefined : end);
  };
  const rnCache = getStep('Cache React Native artifact archives');
  const rnFingerprint = getStep('Compute React Native artifact fingerprint');
  const profileCache = getStep('Cache Detox profile app product');
  const prepareCache = getStep('Prepare restored Detox DerivedData cache');
  const manifestStep = getStep('Write Detox DerivedData cache manifest');
  const recordCache = getStep('Record Detox cache state');
  const pods = getStep('Install Detox CocoaPods dependencies');
  const buildStep = getStep('Build Detox iOS Simulator app');
  const fingerprintStep = getStep('Compute stable Detox cache fingerprints');
  const fingerprintConfigSource = readFileSync(
    join(repositoryRoot, 'scripts/ci/detox-build-config-fingerprint.mjs'),
    'utf8',
  );
  const fingerprintStepIndex = profileWorkflow.indexOf(
    '- name: Compute stable Detox cache fingerprints',
  );
  const rnCacheStepIndex = profileWorkflow.indexOf('- name: Cache React Native artifact archives');
  const buildStepIndex = profileWorkflow.indexOf('- name: Build Detox iOS Simulator app');
  const podsInstallIndex = profileWorkflow.indexOf('- name: Install Detox CocoaPods dependencies');
  const prepareCacheIndex = profileWorkflow.indexOf(
    '- name: Prepare restored Detox DerivedData cache',
  );
  const recordCacheIndex = profileWorkflow.indexOf('- name: Record Detox cache state');
  const manifestStepIndex = profileWorkflow.indexOf(
    '- name: Write Detox DerivedData cache manifest',
  );

  assert.ok(
    fingerprintStep.length > 0 &&
      fingerprintStep.includes(
        'run: node scripts/ci/detox-cache-fingerprint-cli.mjs --derived-data-only',
      ) &&
      fingerprintStepIndex >= 0 &&
      fingerprintStepIndex > rnCacheStepIndex &&
      fingerprintStepIndex > podsInstallIndex &&
      fingerprintStepIndex < buildStepIndex,
  );

  assert.match(rnFingerprint, /id: rn_artifact_fingerprint/);
  assert.match(rnFingerprint, /detox-cache-fingerprint-cli\.mjs --react-native-artifacts-only/);
  assert.match(rnCache, /steps\.rn_artifact_fingerprint\.outputs\.react_native_artifacts/);

  assert.match(rnCache, /uses: actions\/cache@[0-9a-f]{40}/);
  assert.match(rnCache, /path: ~\/Library\/Caches\/ReactNative/);
  assert.match(rnCache, /runner\.os/);
  assert.match(rnCache, /runner\.arch/);
  assert.match(rnCache, /EXPECTED_XCODE_VERSION/);
  assert.match(rnCache, /EXPECTED_IOS_SIMULATOR_SDK/);
  assert.match(rnCache, /inputs\.profile/);
  assert.match(rnCache, /steps\.rn_artifact_fingerprint\.outputs\.react_native_artifacts/);
  assert.doesNotMatch(rnCache, /hashFiles\(/);

  assert.ok(
    prepareCacheIndex > rnCacheStepIndex &&
      prepareCacheIndex < recordCacheIndex &&
      podsInstallIndex < fingerprintStepIndex &&
      fingerprintStepIndex < prepareCacheIndex &&
      recordCacheIndex > prepareCacheIndex &&
      podsInstallIndex < buildStepIndex &&
      recordCacheIndex < buildStepIndex &&
      buildStepIndex < manifestStepIndex,
  );
  assert.match(prepareCache, /detox-derived-data-cache\.mjs prepare/);
  assert.match(prepareCache, /DETOX_CACHE_RUNNER_OS: \$\{\{ runner\.os \}\}/);
  assert.match(prepareCache, /EXPECTED_XCODE_VERSION/);
  assert.match(
    recordCache,
    /run: scripts\/ci\/record-detox-cache-state\.sh artifacts\/detox\/native-cache\.log/,
  );
  assert.match(
    recordCache,
    /DERIVED_DATA_CACHE_CLASSIFICATION:.*outputs\.derived_data_cache_classification/,
  );
  assert.match(recordCache, /NATIVE_DEPENDENCY_FINGERPRINT:.*outputs\.native_dependencies/);
  assert.match(recordCache, /APP_REUSABLE:.*outputs\.app_reusable/);
  assert.match(
    recordCache,
    /PRIVACY_MANIFEST_INPUT_SHA256:.*outputs\.privacy_manifest_input_sha256/,
  );
  assert.match(cacheStateRecorder, /derived_data_cache_classification=/);
  assert.match(cacheStateRecorder, /native_dependency_fingerprint=/);
  assert.match(cacheStateRecorder, /app_reusable=/);
  assert.match(cacheStateRecorder, /privacy_manifest_input_sha256=/);
  assert.match(manifestStep, /detox-derived-data-cache\.mjs write/);
  assert.match(manifestStep, /EXPECTED_PRIVACY_MANIFEST_INPUT_SHA256/);
  assert.doesNotMatch(pods, /if:/);
  assert.match(buildStep, /app_reusable != 'true'/);

  assert.match(profileCache, /uses: actions\/cache@[0-9a-f]{40}/);
  assert.equal(profileCache.match(/orot-detox-deriveddata-v7-/g)?.length, 2);
  assert.match(profileCache, /inputs\.profile == 'release'.*inputs\.profile == 'transcription'/s);
  assert.match(
    profileCache,
    /apps\/mobile\/ios\/build-detox-\$\{\{ inputs\.profile \}\}\/\.orot-detox-cache\.json/,
  );
  assert.match(
    profileCache,
    /apps\/mobile\/ios\/build-detox-\$\{\{ inputs\.profile \}\}\/Build\/Products/,
  );
  assert.match(
    profileCache,
    /native-\$\{\{ steps\.detox_cache_fingerprint\.outputs\.native_dependencies \}\}-build-/,
  );
  assert.match(
    profileCache,
    /build-\$\{\{ steps\.detox_cache_fingerprint\.outputs\.build_inputs \}\}/,
  );
  assert.doesNotMatch(
    profileCache,
    /Build\/Intermediates|Logs|CoreSimulator|Keychains|simulator\.udid/,
  );
  assert.match(fingerprintSource, /pnpm-lock\.yaml/);
  assert.match(fingerprintSource, /apps\/mobile\/ios\/Podfile\.lock/);
  assert.match(fingerprintSource, /apps\/mobile/);
  assert.match(fingerprintSource, /packages/);
  assert.match(fingerprintSource, /nativeDependencies/);
  assert.match(fingerprintConfigSource, /ENTRY_FILE\|FORCE_BUNDLING/);
  assert.match(fingerprintSource, /node_modules/);
  assert.match(fingerprintSource, /iosBuildDirectory\.toLowerCase\(\)/);
  assert.match(fingerprintSource, /build\(\?:-\|\$\)/);

  assert.match(
    buildStep,
    /if: \$\{\{ steps\.prepare_derived_data_cache\.outputs\.app_reusable != 'true' \}\}/,
  );
});
