// Keep profile-specific artifact production and all required E2E status jobs connected.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const producerWorkflow = readFileSync(
  join(repositoryRoot, '.github/workflows/detox-e2e-profile-app-producer.yml'),
  'utf8',
);
const releaseWorkflow = readFileSync(
  join(repositoryRoot, '.github/workflows/detox-e2e-release.yml'),
  'utf8',
);
const profilesWorkflow = readFileSync(
  join(repositoryRoot, '.github/workflows/detox-e2e-profiles.yml'),
  'utf8',
);
const profileWorkflow = readFileSync(
  join(repositoryRoot, '.github/workflows/detox-e2e-profile.yml'),
  'utf8',
);
const statusWorkflow = readFileSync(
  join(repositoryRoot, '.github/workflows/detox-e2e-profile-status.yml'),
  'utf8',
);
const prepareAction = readFileSync(
  join(repositoryRoot, '.github/actions/detox-profile-app-cache/prepare/action.yml'),
  'utf8',
);

function workflowJob(workflow, jobId) {
  const lines = workflow.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`  ${jobId}:`));
  if (start < 0) return '';
  let end = start + 1;
  while (end < lines.length && !/^\s{2}[A-Za-z0-9_-]+:\s*$/.test(lines[end])) end += 1;
  return lines.slice(start, end).join('\n');
}

test('produces one profile-bound artifact from a validated cache or compatible app build', () => {
  const buildStep = workflowJob(producerWorkflow, 'produce_profile_app');
  assert.match(
    producerWorkflow,
    /profile:[\s\S]*required: true[\s\S]*fingerprints:[\s\S]*required: true/,
  );
  assert.match(buildStep, /case "\$DETOX_APP_PROFILE" in[\s\S]*release \| transcription/);
  assert.match(
    buildStep,
    /prepare-detox-runtime\.sh "\$DETOX_APP_PROFILE" && scripts\/ci\/verify-toolchain\.sh/,
  );
  assert.match(buildStep, /detox-cache-fingerprint-cli\.mjs --resolve-shared-derived-data-only/);
  assert.match(buildStep, /profile: \$\{\{ inputs\.profile \}\}/);
  assert.match(buildStep, /build-detox-apps\.sh "\$DETOX_APP_PROFILE" --skip-pods/);
  assert.match(buildStep, /detox-derived-data-cache\.mjs write "\$DETOX_APP_PROFILE"/);
  assert.match(buildStep, /detox-profile-app-artifact\.mjs create "\$DETOX_APP_PROFILE"/);
  assert.match(
    buildStep,
    /XCODEBUILD_FINGERPRINT: \$\{\{ steps\.verify_toolchain\.outputs\.xcodebuild_fingerprint \}\}/,
  );
  assert.match(
    buildStep,
    /EXPECTED_DETOX_BUILD_INPUT_FINGERPRINT: \$\{\{ steps\.resolve_fingerprints\.outputs\.build_inputs \}\}/,
  );
  assert.match(
    buildStep,
    /EXPECTED_DETOX_NATIVE_DEPENDENCY_FINGERPRINT: \$\{\{ steps\.resolve_fingerprints\.outputs\.native_dependencies \}\}/,
  );
  assert.match(producerWorkflow, /actions\/upload-artifact@[a-f0-9]{40}/);
  assert.match(
    producerWorkflow,
    /orot-detox-\$\{\{ inputs\.profile \}\}-app-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/,
  );
  assert.match(producerWorkflow, /retention-days: 7/);
});

test('routes both Release shards through one artifact and keeps their stable status checks', () => {
  const producer = workflowJob(releaseWorkflow, 'produce_release_app');
  assert.match(producer, /detox-e2e-profile-app-producer\.yml/);
  assert.match(producer, /profile: release/);
  assert.match(producer, /if: \$\{\{ inputs\.run_profile && !inputs\.path_selection_failed \}\}/);

  for (const [jobId, statusJobId] of [
    ['run_detox_release_ui_shard', 'detox_release_ui_shard'],
    ['run_detox_release_data_shard', 'detox_release_data_shard'],
  ]) {
    const consumer = workflowJob(releaseWorkflow, jobId);
    assert.match(consumer, /needs: \[produce_release_app\]/);
    assert.match(consumer, /if: \$\{\{ always\(\) && inputs\.run_profile \}\}/);
    assert.match(
      consumer,
      /app_artifact: \$\{\{ toJSON\(needs\.produce_release_app\.outputs\) \}\}/,
    );
    const status = workflowJob(releaseWorkflow, statusJobId);
    assert.match(status, /if: \$\{\{ always\(\) \}\}/);
    assert.match(status, /path_selection_failed: \$\{\{ inputs\.path_selection_failed \}\}/);
    assert.match(
      status,
      new RegExp(`execution_result: \\$\\{\\{ needs\\.${jobId}\\.result \\}\\}`),
    );
  }

  assert.match(
    profileWorkflow,
    /app_artifact: \{ required: false, type: string, default: '\{\}' \}/,
  );
  assert.match(
    profileWorkflow,
    /inputs\.profile == 'release' \|\| inputs\.profile == 'transcription'/,
  );
  assert.match(profileWorkflow, /\.\/\.github\/actions\/detox-profile-app-cache\/prepare/);
});

test('gives Speech its separate artifact and a fresh consumer that samples resources', () => {
  const producer = workflowJob(profilesWorkflow, 'produce_transcription_app');
  const consumer = workflowJob(profilesWorkflow, 'run_detox_transcription_profile');
  const status = workflowJob(profilesWorkflow, 'detox_transcription_e2e');
  assert.match(producer, /profile: transcription/);
  assert.match(producer, /detox-e2e-profile-app-producer\.yml/);
  assert.match(
    producer,
    /if: \$\{\{ !cancelled\(\) && inputs\.run_transcription && !inputs\.path_selection_failed \}\}/,
  );
  assert.match(consumer, /needs: \[detox_cache_fingerprint, produce_transcription_app\]/);
  assert.match(consumer, /if: \$\{\{ always\(\) && inputs\.run_transcription \}\}/);
  assert.match(
    consumer,
    /app_artifact: \$\{\{ toJSON\(needs\.produce_transcription_app\.outputs\) \}\}/,
  );
  assert.match(consumer, /resource_sampling: \$\{\{ inputs\.resource_sampling \}\}/);
  assert.match(status, /if: \$\{\{ always\(\) \}\}/);
  assert.match(status, /name: Speech Transcription E2E/);
  assert.match(
    profileWorkflow,
    /OROT_DETOX_RESOURCE_SAMPLING: \$\{\{ inputs\.resource_sampling \}\}/,
  );
  assert.match(
    prepareAction,
    /steps\.prepare\.outputs\.app_reusable == 'true' \|\| steps\.verify_profile_app\.outputs\.profile_app_reusable == 'true'/,
  );
  assert.match(prepareAction, /actions\/download-artifact@[a-f0-9]{40}/);
  assert.match(prepareAction, /detox-profile-app-artifact\.mjs verify/);
  assert.match(
    profileWorkflow,
    /steps\.prepare_derived_data_cache\.outputs\.app_reusable != 'true'/,
  );
  assert.match(
    profileWorkflow,
    /steps\.prepare_derived_data_cache\.outputs\.detox_artifacts_reusable != 'true'/,
  );
  assert.match(
    profileWorkflow,
    /steps\.prepare_derived_data_cache\.outputs\.app_reusable != 'true'/,
  );
});

test('keeps SDK 27 and the pinned Speech runtime/device contract on the Xcode 27 runner', () => {
  assert.match(profileWorkflow, /DEVELOPER_DIR: \/Applications\/Xcode\.app\/Contents\/Developer/);
  assert.match(profileWorkflow, /EXPECTED_XCODE_VERSION: '27\.0'/);
  assert.match(profileWorkflow, /EXPECTED_IOS_SIMULATOR_SDK: '27\.0'/);
  assert.match(profileWorkflow, /-runtime-ios26\.2-build23C54-device-iphone17pro/);
  assert.match(profileWorkflow, /EXPECTED_IOS_SIMULATOR_RUNTIME_IDENTIFIER:.*iOS-26-2/);
  assert.match(profileWorkflow, /EXPECTED_DETOX_SIMULATOR_DEVICE_TYPE_ID:.*iPhone-17-Pro/);
  assert.match(profileWorkflow, /runs-on: xcode-27/);
  assert.match(
    profileWorkflow,
    /prepare-detox-runtime\.sh "\$\{\{ inputs\.profile \}\}" && scripts\/ci\/verify-toolchain\.sh/,
  );
  assert.match(statusWorkflow, /inputs\.path_selection_failed/);
  assert.match(statusWorkflow, /inputs\.run_profile && inputs\.execution_result != 'success'/);
});

test('classifies restored cache state before downloading and installing the run artifact', () => {
  assert.match(prepareAction, /node scripts\/ci\/detox-derived-data-cache\.mjs prepare/);
  assert.match(
    prepareAction,
    /DETOX_CACHE_RUNNER_OS: \$\{\{ fromJSON\(inputs\.runner_context\)\.os \}\}/,
  );
  assert.match(
    prepareAction,
    /MACOS_VERSION: \$\{\{ fromJSON\(inputs\.workflow_steps\)\.verify_toolchain\.outputs\.macos_version \}\}/,
  );
  assert.match(
    prepareAction,
    /EXPECTED_XCODE_VERSION: \$\{\{ fromJSON\(inputs\.workflow_env\)\.EXPECTED_XCODE_VERSION \}\}/,
  );
  assert.match(
    prepareAction,
    /EXPECTED_IOS_SIMULATOR_SDK: \$\{\{ fromJSON\(inputs\.workflow_env\)\.EXPECTED_IOS_SIMULATOR_SDK \}\}/,
  );
  assert.ok(
    prepareAction.indexOf('- name: Prepare restored Detox DerivedData cache') <
      prepareAction.indexOf('- name: Download run-bound profile app artifact'),
  );
});
