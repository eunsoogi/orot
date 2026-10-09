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
const profileCacheAction = readFileSync(
  join(repositoryRoot, '.github/actions/detox-profile-app-cache/restore/action.yml'),
  'utf8',
);
const fingerprintSource = readFileSync(
  join(repositoryRoot, 'scripts/ci/detox-cache-fingerprint.mjs'),
  'utf8',
);
const fingerprintInputSource = readFileSync(
  join(repositoryRoot, 'scripts/ci/detox-cache-inputs.mjs'),
  'utf8',
);
const fingerprintConfigSource = readFileSync(
  join(repositoryRoot, 'scripts/ci/detox-build-config-fingerprint.mjs'),
  'utf8',
);
const fingerprintCliSource = readFileSync(
  join(repositoryRoot, 'scripts/ci/detox-cache-fingerprint-cli.mjs'),
  'utf8',
);
const cacheStateRecorder = readFileSync(
  join(repositoryRoot, 'scripts/ci/record-detox-cache-state.sh'),
  'utf8',
);

function workflowJob(source, jobId) {
  const start = source.indexOf(`  ${jobId}:\n`);
  if (start < 0) return '';
  // Keep assertions scoped to the next top-level workflow job.
  const nextJob = /\n {2}[a-z0-9_]+:\n/.exec(source.slice(start + 1));
  return source.slice(start, nextJob ? start + 1 + nextJob.index : undefined);
}

function workflowStep(source, name) {
  const start = source.indexOf(`- name: ${name}`);
  const end = source.indexOf('\n      - name:', start + 1);
  return start < 0 ? '' : source.slice(start, end < 0 ? undefined : end);
}

test('computes common app fingerprints once and shares them with every profile', () => {
  const fingerprintJob = workflowJob(profilesWorkflow, 'detox_cache_fingerprint');
  const profileJobs = ['detox_release_e2e', 'detox_openai_provider_e2e', 'detox_transcription_e2e'];

  // Profiles share source hashes while cache keys retain runner and Xcode identity.
  assert.match(fingerprintJob, /name: Compute shared Detox cache fingerprints/);
  assert.match(fingerprintJob, /runs-on: ubuntu-latest/);
  assert.match(fingerprintJob, /timeout-minutes: 5/);
  assert.match(
    fingerprintJob,
    /node scripts\/ci\/detox-cache-fingerprint-cli\.mjs --derived-data-only/,
  );
  assert.equal(
    profilesWorkflow.match(/detox-cache-fingerprint-cli\.mjs --derived-data-only/g)?.length,
    1,
  );
  for (const output of [
    'build_inputs',
    'build_input_count',
    'native_dependencies',
    'native_dependency_input_count',
    'privacy_manifest_input_sha256',
    'cocoapods_project_input_sha256',
  ]) {
    assert.match(
      fingerprintJob,
      new RegExp(
        `${output}: \\$\\{\\{ steps\\.detox_cache_fingerprint\\.outputs\\.${output} \\}\\}`,
      ),
    );
  }
  for (const jobId of profileJobs) {
    const job = workflowJob(profilesWorkflow, jobId);
    assert.match(job, /needs: \[detox_cache_fingerprint\]/);
    assert.match(
      job,
      /fingerprints: \$\{\{ toJSON\(needs\.detox_cache_fingerprint\.outputs\) \}\}/,
    );
  }

  assert.match(
    profilesWorkflow,
    /needs: \[detox_release_e2e, detox_openai_provider_e2e, detox_transcription_e2e\]/,
  );
  assert.match(profilesWorkflow, /if: \$\{\{ always\(\) \}\}/);
  assert.match(profilesWorkflow, /require-detox-e2e-aggregate\.mjs/);
  for (const checkName of [
    'Detox Release iOS E2E',
    'Detox OpenAI Debug iOS E2E',
    'Detox Speech Transcription iOS E2E',
    'Require complete profile summaries',
  ]) {
    assert.ok(profilesWorkflow.includes(`name: ${checkName}`));
  }
});

test('passes shared hashes directly into cache validation and preserves profile behavior', () => {
  const profileCache = workflowStep(profileWorkflow, 'Cache Detox profile app product');
  const prepareCache = workflowStep(profileWorkflow, 'Prepare restored Detox DerivedData cache');
  const manifestStep = workflowStep(profileWorkflow, 'Write Detox DerivedData cache manifest');
  const recordCache = workflowStep(profileWorkflow, 'Record Detox cache state');
  const pods = workflowStep(profileWorkflow, 'Install Detox CocoaPods dependencies');
  const buildStep = workflowStep(profileWorkflow, 'Build Detox iOS Simulator app');
  const prepareCacheIndex = profileWorkflow.indexOf(
    '- name: Prepare restored Detox DerivedData cache',
  );
  const profileCacheIndex = profileWorkflow.indexOf('- name: Cache Detox profile app product');
  const podsInstallIndex = profileWorkflow.indexOf('- name: Install Detox CocoaPods dependencies');
  const recordCacheIndex = profileWorkflow.indexOf('- name: Record Detox cache state');
  const buildStepIndex = profileWorkflow.indexOf('- name: Build Detox iOS Simulator app');
  const manifestStepIndex = profileWorkflow.indexOf(
    '- name: Write Detox DerivedData cache manifest',
  );

  assert.match(
    profileWorkflow,
    /fingerprints:\n\s+description: Shared source and build fingerprints from the profile workflow\.\n\s+required: true\n\s+type: string/,
  );
  assert.doesNotMatch(profileWorkflow, /detox-cache-fingerprint-cli\.mjs --derived-data-only/);
  assert.match(profileCache, /fingerprints: \$\{\{ inputs\.fingerprints \}\}/);
  assert.match(
    profileCache,
    /native-\$\{\{ fromJSON\(inputs\.fingerprints\)\.native_dependencies \}\}/,
  );
  assert.match(profileCache, /build-\$\{\{ fromJSON\(inputs\.fingerprints\)\.build_inputs \}\}/);
  assert.equal(profileCache.match(/orot-detox-app-product-v10-/g)?.length, 2);
  assert.match(profileCache, /runner\.os/);
  assert.match(profileCache, /runner\.arch/);
  assert.match(profileCache, /steps\.verify_toolchain\.outputs\.macos_version/);
  assert.match(profileCache, /steps\.verify_toolchain\.outputs\.xcodebuild_fingerprint/);
  assert.match(profileCache, /env\.EXPECTED_IOS_SIMULATOR_SDK/);
  assert.match(profileCache, /inputs\.profile/);

  assert.ok(
    profileCacheIndex >= 0 &&
      profileCacheIndex < prepareCacheIndex &&
      prepareCacheIndex < recordCacheIndex &&
      prepareCacheIndex < podsInstallIndex &&
      podsInstallIndex < buildStepIndex &&
      recordCacheIndex < buildStepIndex &&
      buildStepIndex < manifestStepIndex,
  );
  assert.match(prepareCache, /detox-derived-data-cache\.mjs prepare/);
  assert.match(prepareCache, /DETOX_CACHE_RUNNER_OS: \$\{\{ runner\.os \}\}/);
  assert.match(
    recordCache,
    /run: scripts\/ci\/record-detox-cache-state\.sh artifacts\/detox\/native-cache\.log/,
  );
  assert.match(
    recordCache,
    /BUILD_INPUT_FINGERPRINT:.*steps\.profile_derived_data_cache\.outputs\.build_inputs/,
  );
  assert.match(
    recordCache,
    /NATIVE_DEPENDENCY_FINGERPRINT:.*steps\.profile_derived_data_cache\.outputs\.native_dependencies/,
  );
  assert.match(
    recordCache,
    /APP_REUSABLE:.*steps\.prepare_derived_data_cache\.outputs\.app_reusable/,
  );
  assert.match(
    recordCache,
    /PRIVACY_MANIFEST_INPUT_SHA256:.*steps\.profile_derived_data_cache\.outputs\.privacy_manifest_input_sha256/,
  );
  assert.match(cacheStateRecorder, /derived_data_cache_classification=/);
  assert.match(cacheStateRecorder, /native_dependency_fingerprint=/);
  assert.match(cacheStateRecorder, /app_reusable=/);
  assert.match(cacheStateRecorder, /privacy_manifest_input_sha256=/);
  assert.match(manifestStep, /detox-derived-data-cache\.mjs write/);
  assert.match(
    manifestStep,
    /EXPECTED_DETOX_BUILD_INPUT_FINGERPRINT:.*steps\.profile_derived_data_cache\.outputs\.build_inputs/,
  );
  assert.match(
    manifestStep,
    /EXPECTED_DETOX_NATIVE_DEPENDENCY_FINGERPRINT:.*steps\.profile_derived_data_cache\.outputs\.native_dependencies/,
  );
  assert.match(
    manifestStep,
    /EXPECTED_PRIVACY_MANIFEST_INPUT_SHA256:.*steps\.profile_derived_data_cache\.outputs\.privacy_manifest_input_sha256/,
  );
  assert.match(pods, /steps\.prepare_derived_data_cache\.outputs\.app_reusable != 'true'/);
  assert.match(buildStep, /app_reusable != 'true'/);

  assert.doesNotMatch(profileCacheAction, /Publish shared Detox cache fingerprints/);
  assert.doesNotMatch(profileCacheAction, /detox-cache-fingerprint-cli\.mjs/);
  for (const field of [
    'build_inputs',
    'native_dependencies',
    'privacy_manifest_input_sha256',
    'cocoapods_project_input_sha256',
  ]) {
    const expectedOutput = `value: \${{ fromJSON(inputs.fingerprints).${field} }}`;
    assert.ok(profileCacheAction.includes(expectedOutput));
  }
  assert.match(profileCacheAction, /uses: actions\/cache\/restore@[0-9a-f]{40}/);
  assert.match(
    profileCacheAction,
    /apps\/mobile\/ios\/build-detox-\$\{\{ inputs\.profile \}\}\/\.orot-detox-cache\.json/,
  );
  assert.match(
    profileCacheAction,
    /Build\/Products\/\$\{\{ inputs\.profile == 'openai-provider' && 'Debug' \|\| 'Release' \}\}-iphonesimulator\/Orot\.app/,
  );
  assert.match(profileCacheAction, /~\/Library\/Detox\/ios\/framework/);
  assert.match(profileCacheAction, /~\/Library\/Detox\/ios\/xcuitest-runner/);
  assert.doesNotMatch(
    profileCacheAction,
    /Build\/Intermediates|Logs|CoreSimulator|Keychains|simulator\.udid/,
  );
  assert.match(fingerprintSource, /pnpm-lock\.yaml/);
  assert.match(fingerprintSource, /apps\/mobile\/ios\/Podfile\.lock/);
  assert.match(fingerprintSource, /apps\/mobile/);
  assert.match(fingerprintSource, /packages/);
  assert.match(fingerprintSource, /nativeDependencies/);
  assert.match(fingerprintConfigSource, /ENTRY_FILE\|FORCE_BUNDLING/);
  assert.match(fingerprintInputSource, /node_modules/);
  assert.match(fingerprintInputSource, /iosBuildDirectory\.toLowerCase\(\)/);
  assert.match(fingerprintInputSource, /build\(\?:-\|\$\)/);
  assert.match(fingerprintCliSource, /writeGitHubEnvironment/);
  assert.match(fingerprintCliSource, /EXPECTED_COCOAPODS_INPUT_HASHES_JSON/);
});
