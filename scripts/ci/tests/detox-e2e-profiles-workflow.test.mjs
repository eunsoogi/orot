import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(fileURLToPath(new URL(path, root)), 'utf8');
const ciWorkflow = read('.github/workflows/ci.yml');
const profilesWorkflow = read('.github/workflows/detox-e2e-profiles.yml');
const releaseWorkflow = read('.github/workflows/detox-e2e-release.yml');
const profileWorkflow = read('.github/workflows/detox-e2e-profile.yml');
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
  assert.match(
    ciWorkflow,
    /detox_profiles:[\s\S]*?name: Detox E2E profiles[\s\S]*?uses: \.\/\.github\/workflows\/detox-e2e-profiles\.yml/,
  );
  assert.doesNotMatch(ciWorkflow, /name: Detox iOS E2E|detox_ios_e2e:/);
  assert.doesNotMatch(
    profilesWorkflow,
    /validate_detox_profiles|Require complete profile summaries/,
  );
  assert.doesNotMatch(profilesWorkflow, /require-detox-e2e-aggregate\.mjs/);
  assert.doesNotMatch(profilesWorkflow, /require-detox-transcription-aggregate\.mjs/);
});

test('runs every profile as an independent leaf and continues after fingerprint failure', () => {
  const profiles = [
    ['detox_release_e2e', 'release', 'detox-e2e-release.yml'],
    ['detox_openai_provider_e2e', 'openai-provider', 'detox-e2e-profile.yml'],
    ['detox_transcription_e2e', 'transcription', 'detox-e2e-profile.yml'],
    ['detox_next_visit_e2e', 'next-visit-questions', 'detox-e2e-profile.yml'],
  ];
  for (const [jobId, profile, workflow] of profiles) {
    const job = jobBlock(profilesWorkflow, jobId);
    assert.ok(job, `missing ${profile} E2E leaf`);
    assert.match(job, /needs: \[detox_cache_fingerprint\]/);
    assert.match(job, /if: \$\{\{ !cancelled\(\) \}\}/);
    assert.ok(job.includes(`uses: ./.github/workflows/${workflow}`));
    if (profile !== 'release') assert.match(job, new RegExp(`profile: ${profile}`));
    assert.match(
      job,
      /fingerprints: \$\{\{ toJSON\(needs\.detox_cache_fingerprint\.outputs\) \}\}/,
    );
  }
  assert.doesNotMatch(profilesWorkflow, /needs: \[detox_release_e2e, detox_openai_provider_e2e/);
  assert.match(
    profileWorkflow,
    /scripts\/ci\/run-test-suite\.sh "e2e-\$\{\{ inputs\.profile \}\}"/,
  );
  assert.match(summaryGuard, /expected exactly one profile summary/);
  assert.match(summaryGuard, /14\]/);
  assert.match(suiteRunner, /node scripts\/ci\/require-jest-summary\.mjs/);
});

test('keeps Release UI/storage and stateful-data as separate checked shard jobs', () => {
  assert.doesNotMatch(
    releaseWorkflow,
    /validate_release_profile|Require complete Release shard results/,
  );
  assert.doesNotMatch(releaseWorkflow, /require-detox-release-shard-aggregate\.mjs/);
  assert.doesNotMatch(releaseWorkflow, /^\x20{2}outputs:/m);

  const ui = jobBlock(releaseWorkflow, 'detox_release_ui_shard');
  const data = jobBlock(releaseWorkflow, 'detox_release_data_shard');
  assert.match(ui, /name: Release UI and storage/);
  assert.match(ui, /release_shard: release-e2e\.test\.js/);
  assert.match(data, /name: Release stateful-data/);
  assert.match(data, /release_shard: release-e2e-data\.test\.js/);
  assert.match(ui, /uses: \.\/\.github\/workflows\/detox-e2e-profile\.yml/);
  assert.match(data, /uses: \.\/\.github\/workflows\/detox-e2e-profile\.yml/);
  assert.match(profileWorkflow, /OROT_DETOX_RELEASE_SHARD: \$\{\{ inputs\.release_shard \}\}/);
  assert.equal(
    [...releaseWorkflow.matchAll(/fingerprints: \$\{\{ inputs\.fingerprints \}\}/g)].length,
    2,
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
