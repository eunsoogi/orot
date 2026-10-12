import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { REQUIRED_CI_JOBS } from '../../release/ci-required-jobs.mjs';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(fileURLToPath(new URL(path, root)), 'utf8');
const ciWorkflow = read('.github/workflows/e2e-test.yml');
const profilesWorkflow = read('.github/workflows/detox-e2e-profiles.yml');
const releaseWorkflow = read('.github/workflows/detox-e2e-release.yml');
const profileWorkflow = read('.github/workflows/detox-e2e-profile.yml');
const profileStatusWorkflowExists = existsSync(
  fileURLToPath(new URL('.github/workflows/detox-e2e-profile-status.yml', root)),
);
const profileStatusWorkflow = profileStatusWorkflowExists
  ? read('.github/workflows/detox-e2e-profile-status.yml')
  : '';
const summaryGuard = read('scripts/ci/require-jest-summary.mjs');
const suiteRunner = read('scripts/ci/run-test-suite.sh');

function jobBlock(source, jobId) {
  // Keep each assertion inside one workflow job so neighboring leaves cannot satisfy it.
  const start = source.indexOf(`  ${jobId}:\n`);
  if (start < 0) return '';
  const nextJob = /\n {2}[a-z0-9_]+:\n/.exec(source.slice(start + 1));
  return source.slice(start, nextJob ? start + 1 + nextJob.index : undefined);
}

test('exposes profile scenario results without CI summary wrapper jobs', () => {
  const profileJob = jobBlock(ciWorkflow, 'detox_profiles');
  assert.match(profileJob, /Focus profile routing/);
  assert.match(profileJob, /Detox E2E profiles/);
  assert.match(profileJob, /uses: \.\/\.github\/workflows\/detox-e2e-profiles\.yml/);
  assert.doesNotMatch(ciWorkflow, /name: Detox iOS E2E|detox_ios_e2e:/);
  assert.doesNotMatch(
    profilesWorkflow,
    /validate_detox_profiles|Require complete profile summaries/,
  );
  assert.doesNotMatch(profilesWorkflow, /require-detox-e2e-aggregate\.mjs/);
  assert.doesNotMatch(profilesWorkflow, /require-detox-transcription-aggregate\.mjs/);
});

test('keeps required E2E check names resolved when profile work is skipped', () => {
  assert.ok(profileStatusWorkflowExists, 'missing stable E2E status workflow');
  const statusJob = jobBlock(profileStatusWorkflow, 'profile_status');
  assert.match(statusJob, /name: Detox \$\{\{ inputs\.profile \}\} iOS E2E/);
  assert.match(statusJob, /if: \$\{\{ always\(\) \}\}/);
  assert.match(profileStatusWorkflow, /inputs\.path_selection_failed/);
  assert.match(profileStatusWorkflow, /inputs\.full_validation_deferred/);
  assert.match(profileStatusWorkflow, /inputs\.execution_result/);

  const profiles = [
    [
      'run_detox_openai_provider_profile',
      'detox_openai_provider_e2e',
      'OpenAI Debug E2E',
      'openai-provider',
    ],
    [
      'run_detox_next_visit_profile',
      'detox_next_visit_e2e',
      'Next Visit Questions E2E',
      'next-visit-questions',
    ],
  ];
  for (const [runnerId, statusId, name, profile] of profiles) {
    const runner = jobBlock(profilesWorkflow, runnerId);
    const status = jobBlock(profilesWorkflow, statusId);
    assert.match(runner, /name: Execute .* profile/);
    assert.match(runner, /uses: \.\/\.github\/workflows\/detox-e2e-profile\.yml/);
    assert.match(runner, new RegExp(`profile: ${profile}`));
    assert.match(status, new RegExp(`name: ${name}`));
    assert.match(status, /if: \$\{\{ always\(\) \}\}/);
    assert.match(status, /uses: \.\/\.github\/workflows\/detox-e2e-profile-status\.yml/);
    assert.ok(status.includes(`execution_result: \${{ needs.${runnerId}.result }}`));
    assert.ok(status.includes('full_validation_deferred: ${{ inputs.full_validation_deferred }}'));
    // Keep these resolved reusable-workflow names aligned with branch protection.
    assert.ok(
      REQUIRED_CI_JOBS.includes(`Detox E2E profiles / ${name} / Detox ${profile} iOS E2E`),
      `release policy omits the ${profile} status check`,
    );
  }
});

test('runs each selected profile independently and continues after fingerprint failure', () => {
  const profiles = [
    ['run_detox_openai_provider_profile', 'openai-provider', 'run_openai'],
    ['run_detox_next_visit_profile', 'next-visit-questions', 'run_next_visit'],
  ];
  for (const [jobId, profile, runInput] of profiles) {
    const job = jobBlock(profilesWorkflow, jobId);
    assert.ok(job, `missing ${profile} E2E executor`);
    assert.match(job, /needs: \[detox_cache_fingerprint\]/);
    assert.ok(
      job.includes(
        `if: \${{ !cancelled() && inputs.${runInput} && !inputs.full_validation_deferred }}`,
      ),
    );
    assert.ok(job.includes('uses: ./.github/workflows/detox-e2e-profile.yml'));
    assert.match(job, new RegExp(`profile: ${profile}`));
    assert.match(
      job,
      /fingerprints: \$\{\{ toJSON\(needs\.detox_cache_fingerprint\.outputs\) \}\}/,
    );
  }
  const speechProducer = jobBlock(profilesWorkflow, 'produce_transcription_app');
  const speechConsumer = jobBlock(profilesWorkflow, 'run_detox_transcription_profile');
  assert.match(speechProducer, /profile: transcription/);
  assert.match(
    speechProducer,
    /if: \$\{\{ !cancelled\(\) && inputs\.run_transcription && !inputs\.path_selection_failed && !inputs\.full_validation_deferred \}\}/,
  );
  assert.match(speechConsumer, /needs: \[detox_cache_fingerprint, produce_transcription_app\]/);
  assert.match(
    speechConsumer,
    /if: \$\{\{ always\(\) && inputs\.run_transcription && !inputs\.full_validation_deferred \}\}/,
  );
  assert.match(speechConsumer, /profile: transcription/);
  assert.match(
    speechConsumer,
    /app_artifact: \$\{\{ toJSON\(needs\.produce_transcription_app\.outputs\) \}\}/,
  );
  assert.match(speechConsumer, /resource_sampling: \$\{\{ inputs\.resource_sampling \}\}/);

  assert.match(
    jobBlock(profilesWorkflow, 'detox_release_e2e'),
    /uses: \.\/\.github\/workflows\/detox-e2e-release\.yml/,
  );
  assert.doesNotMatch(profilesWorkflow, /needs: \[detox_release_e2e, detox_openai_provider_e2e/);
  assert.match(
    profileWorkflow,
    /scripts\/ci\/run-test-suite\.sh "e2e-\$\{\{ inputs\.profile \}\}"/,
  );
  assert.match(summaryGuard, /expected exactly one profile summary/);
  assert.match(summaryGuard, /21\]/);
  assert.match(suiteRunner, /node scripts\/ci\/require-jest-summary\.mjs/);
});

test('keeps Release UI/storage and stateful-data as separate checked shard jobs', () => {
  assert.doesNotMatch(
    releaseWorkflow,
    /validate_release_profile|Require complete Release shard results/,
  );
  assert.doesNotMatch(releaseWorkflow, /require-detox-release-shard-aggregate\.mjs/);
  assert.doesNotMatch(releaseWorkflow, /^\x20{2}outputs:/m);

  const ui = jobBlock(releaseWorkflow, 'run_detox_release_ui_shard');
  const data = jobBlock(releaseWorkflow, 'run_detox_release_data_shard');
  const uiStatus = jobBlock(releaseWorkflow, 'detox_release_ui_shard');
  const dataStatus = jobBlock(releaseWorkflow, 'detox_release_data_shard');
  assert.match(ui, /name: Execute Release UI and storage profile/);
  assert.match(ui, /release_shard: release-e2e\.test\.js/);
  assert.match(data, /name: Execute Release stateful-data profile/);
  assert.match(data, /release_shard: release-e2e-data\.test\.js/);
  assert.match(ui, /uses: \.\/\.github\/workflows\/detox-e2e-profile\.yml/);
  assert.match(data, /uses: \.\/\.github\/workflows\/detox-e2e-profile\.yml/);
  assert.match(uiStatus, /name: Release UI and storage/);
  assert.match(uiStatus, /uses: \.\/\.github\/workflows\/detox-e2e-profile-status\.yml/);
  assert.match(uiStatus, /if: \$\{\{ always\(\) \}\}/);
  assert.match(dataStatus, /name: Release stateful-data/);
  assert.match(dataStatus, /uses: \.\/\.github\/workflows\/detox-e2e-profile-status\.yml/);
  assert.match(dataStatus, /if: \$\{\{ always\(\) \}\}/);
  for (const status of [uiStatus, dataStatus]) {
    assert.ok(status.includes('full_validation_deferred: ${{ inputs.full_validation_deferred }}'));
  }
  for (const name of ['Release UI and storage', 'Release stateful-data']) {
    assert.ok(
      REQUIRED_CI_JOBS.includes(
        `Detox E2E profiles / Release shards / ${name} / Detox release iOS E2E`,
      ),
      `release policy omits the ${name} status check`,
    );
  }
  assert.match(profileWorkflow, /OROT_DETOX_RELEASE_SHARD: \$\{\{ inputs\.release_shard \}\}/);
  // The shared fingerprint input feeds the producer and both independent Release shards.
  assert.equal(
    [...releaseWorkflow.matchAll(/fingerprints: \$\{\{ inputs\.fingerprints \}\}/g)].length,
    3,
  );
});

test('uses the shared profile inventory and removes the path-filtered Next Visit duplicate', () => {
  assert.match(profilesWorkflow, /profile: next-visit-questions/);
  assert.match(summaryGuard, /Next Visit Questions/);
  assert.match(summaryGuard, /e2e-next-visit-questions/);
  assert.equal(
    existsSync(fileURLToPath(new URL('.github/workflows/next-visit-questions-e2e.yml', root))),
    false,
  );
});
