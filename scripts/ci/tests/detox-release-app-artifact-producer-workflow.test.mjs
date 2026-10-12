// Keep the artifact producer tied to the validated Release cache and one build.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const producerWorkflow = readFileSync(
  join(repositoryRoot, '.github/workflows/detox-e2e-release-app-producer.yml'),
  'utf8',
);
const releaseWorkflow = readFileSync(
  join(repositoryRoot, '.github/workflows/detox-e2e-release.yml'),
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

test('publishes a run-bound artifact from the validated Release build or exact cache hit', () => {
  const buildStart = producerWorkflow.indexOf('- name: Build Release Detox app');
  const buildStep = producerWorkflow.slice(
    buildStart,
    producerWorkflow.indexOf('\n      - name:', buildStart + 1),
  );
  const toolchainStart = producerWorkflow.indexOf('- name: Verify runner toolchain');
  const toolchainStep = producerWorkflow.slice(
    toolchainStart,
    producerWorkflow.indexOf('\n      - name:', toolchainStart + 1),
  );
  const manifestStart = producerWorkflow.indexOf(
    '- name: Write validated Release DerivedData cache manifest',
  );
  const manifestStep = producerWorkflow.slice(
    manifestStart,
    producerWorkflow.indexOf('\n      - name:', manifestStart + 1),
  );
  const artifactStart = producerWorkflow.indexOf('- name: Create run-bound Release app artifact');
  const artifactStep = producerWorkflow.slice(
    artifactStart,
    producerWorkflow.indexOf('\n      - name:', artifactStart + 1),
  );

  assert.match(producerWorkflow, /workflow_call:[\s\S]*fingerprints:[\s\S]*required: true/);
  assert.match(
    toolchainStep,
    /prepare-detox-runtime\.sh release && scripts\/ci\/verify-toolchain\.sh/,
  );
  assert.match(toolchainStep, /timeout-minutes: 20/);
  assert.match(
    producerWorkflow,
    /detox-cache-fingerprint-cli\.mjs --resolve-shared-derived-data-only/,
  );
  assert.match(buildStep, /app_reusable != 'true'/);
  assert.match(buildStep, /build-detox-apps\.sh release --skip-pods/);
  assert.match(manifestStep, /detox-derived-data-cache\.mjs write release/);
  assert.ok(
    producerWorkflow.indexOf('- name: Save validated Release app product') <
      producerWorkflow.indexOf('- name: Create run-bound Release app artifact'),
  );
  assert.match(
    artifactStep,
    /detox-release-app-artifact\.mjs create artifacts\/detox\/release-app/,
  );
  for (const input of [
    'XCODEBUILD_FINGERPRINT: ${{ steps.verify_toolchain.outputs.xcodebuild_fingerprint }}',
    'EXPECTED_DETOX_BUILD_INPUT_FINGERPRINT: ${{ steps.resolve_fingerprints.outputs.build_inputs }}',
    'EXPECTED_DETOX_NATIVE_DEPENDENCY_FINGERPRINT: ${{ steps.resolve_fingerprints.outputs.native_dependencies }}',
  ]) {
    assert.ok(artifactStep.includes(input), `The producer must bind ${input.split(':')[0]}.`);
  }
  assert.match(producerWorkflow, /actions\/upload-artifact@[a-f0-9]{40}/);
  assert.match(producerWorkflow, /retention-days: 7/);
  assert.match(
    releaseWorkflow,
    /run_detox_release_ui_shard:[\s\S]*if: \$\{\{ always\(\) && inputs\.run_profile \}\}/,
  );
  assert.match(
    releaseWorkflow,
    /detox_release_ui_shard:[\s\S]*if: \$\{\{ always\(\) \}\}[\s\S]*path_selection_failed:/,
  );
  assert.match(
    releaseWorkflow,
    /run_detox_release_data_shard:[\s\S]*if: \$\{\{ always\(\) && inputs\.run_profile \}\}/,
  );
  assert.match(
    releaseWorkflow,
    /detox_release_data_shard:[\s\S]*if: \$\{\{ always\(\) \}\}[\s\S]*path_selection_failed:/,
  );
});

test('routes both Release shards through one verified app and preserves required status behavior', () => {
  const producer = workflowJob(releaseWorkflow, 'produce_release_app');
  assert.match(producer, /detox-e2e-release-app-producer\.yml/);
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
      /release_app_artifact: \$\{\{ toJSON\(needs\.produce_release_app\.outputs\) \}\}/,
    );
    const status = workflowJob(releaseWorkflow, statusJobId);
    assert.match(status, /if: \$\{\{ always\(\) \}\}/);
    assert.match(
      status,
      new RegExp(`execution_result: \\$\\{\\{ needs\\.${jobId}\\.result \\}\\}`),
    );
    assert.match(status, /path_selection_failed: \$\{\{ inputs\.path_selection_failed \}\}/);
  }

  assert.match(
    profileWorkflow,
    /release_app_artifact: \{ required: false, type: string, default: '\{\}' \}/,
  );
  assert.match(profileWorkflow, /inputs\.profile == 'release'[\s\S]*release_app_artifact/);
  assert.match(profileWorkflow, /\.\/\.github\/actions\/detox-profile-app-cache\/prepare/);
  assert.match(
    prepareAction,
    /steps\.prepare\.outputs\.app_reusable == 'true' \|\| steps\.verify_release_app\.outputs\.release_app_reusable == 'true'/,
  );
  assert.match(prepareAction, /actions\/download-artifact@[a-f0-9]{40}/);
  assert.match(prepareAction, /detox-release-app-artifact\.mjs verify/);
  assert.match(
    profileWorkflow,
    /steps\.prepare_derived_data_cache\.outputs\.app_reusable != 'true'/,
  );
  assert.match(
    profileWorkflow,
    /steps\.prepare_derived_data_cache\.outputs\.derived_data_cache_app_reusable != 'true'/,
  );
  assert.match(profileWorkflow, /DEVELOPER_DIR: \/Applications\/Xcode\.app\/Contents\/Developer/);
  assert.match(profileWorkflow, /EXPECTED_XCODE_VERSION: '27\.0'/);
  assert.match(profileWorkflow, /EXPECTED_IOS_SIMULATOR_SDK: '27\.0'/);
  assert.match(profileWorkflow, /-runtime-ios26\.2-build23C54-device-iphone17pro/);
  assert.match(profileWorkflow, /runs-on: xcode-27/);
  assert.match(
    profileWorkflow,
    /timeout-minutes:\s*20\s+run:\s*bash scripts\/ci\/prepare-detox-runtime\.sh "\$\{\{ inputs\.profile \}\}" && scripts\/ci\/verify-toolchain\.sh/,
  );
  assert.match(statusWorkflow, /if: \$\{\{ inputs\.path_selection_failed \}\}/);
  assert.match(
    statusWorkflow,
    /inputs\.run_profile && inputs\.execution_result != 'success' && !inputs\.path_selection_failed/,
  );
  assert.match(statusWorkflow, /!inputs\.run_profile && !inputs\.path_selection_failed/);
});

test('passes runner identity through cache preparation before installing the Release app', () => {
  const prepareStepStart = profileWorkflow.indexOf(
    '- name: Prepare restored Detox DerivedData cache',
  );
  const prepareStep = profileWorkflow.slice(
    prepareStepStart,
    profileWorkflow.indexOf('\n      - name:', prepareStepStart + 1),
  );

  assert.match(prepareStep, /uses: \.\/\.github\/actions\/detox-profile-app-cache\/prepare/);
  assert.match(prepareStep, /workflow_inputs: \$\{\{ toJSON\(inputs\) \}\}/);
  assert.match(prepareStep, /workflow_steps: \$\{\{ toJSON\(steps\) \}\}/);
  assert.match(prepareStep, /runner_context: \$\{\{ toJSON\(runner\) \}\}/);
  assert.match(prepareStep, /workflow_env: \$\{\{ toJSON\(env\) \}\}/);
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
  // Clear stale DerivedData before the downloaded artifact is copied into the build tree.
  assert.ok(
    prepareAction.indexOf('- name: Prepare restored Detox DerivedData cache') <
      prepareAction.indexOf('- name: Download run-bound Release app artifact'),
  );
});
