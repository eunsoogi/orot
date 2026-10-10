import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const ciWorkflow = readFileSync(join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8');
const profilesWorkflow = readFileSync(
  join(repositoryRoot, '.github/workflows/detox-e2e-profiles.yml'),
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

test('preserves the required check name while delegating the profile suite', () => {
  assert.match(
    ciWorkflow,
    /detox_profiles:[\s\S]*?uses: \.\/\.github\/workflows\/detox-e2e-profiles\.yml/,
  );
  const aggregate = ciWorkflow.slice(ciWorkflow.indexOf('  detox_ios_e2e:'));
  assert.match(aggregate, /name: Detox iOS E2E/);
  assert.match(aggregate, /needs: \[detox_profiles\]/);
  assert.match(aggregate, /if: \$\{\{ always\(\) \}\}/);
  assert.match(aggregate, /DETOX_PROFILES_RESULT: \$\{\{ needs\.detox_profiles\.result \}\}/);
  assert.match(aggregate, /All Detox profiles and fail-closed summaries passed/);
});

test('runs all three isolated profiles and validates their summaries before returning success', () => {
  for (const profile of ['openai-provider', 'transcription']) {
    assert.match(profilesWorkflow, new RegExp(`profile: ${profile.replace('-', '\\-')}`));
  }
  assert.match(releaseWorkflow, /profile: release/);
  assert.match(
    profilesWorkflow,
    /needs: \[detox_release_e2e, detox_openai_provider_e2e, detox_transcription_e2e\]/,
  );
  assert.match(profilesWorkflow, /if: \$\{\{ always\(\) \}\}/);
  assert.match(profilesWorkflow, /require-detox-e2e-aggregate\.mjs/);
  assert.match(profilesWorkflow, /require-detox-transcription-aggregate\.mjs/);
});

test('keeps the Release check name while running its complete split on three isolated runners', () => {
  assert.match(
    profilesWorkflow,
    /detox_release_e2e:[\s\S]*?name: Detox Release iOS E2E[\s\S]*?uses: \.\/\.github\/workflows\/detox-e2e-release\.yml/,
  );
  assert.match(
    releaseWorkflow,
    /detox_release_ui_shard:[\s\S]*?release_shard: release-e2e\.test\.js/,
  );
  assert.match(
    releaseWorkflow,
    /detox_release_safe_area_shard:[\s\S]*?release_shard: release-e2e-safe-area\.test\.js/,
  );
  assert.match(
    releaseWorkflow,
    /detox_release_data_shard:[\s\S]*?release_shard: release-e2e-data\.test\.js/,
  );
  assert.match(
    releaseWorkflow,
    /detox_profile:[\s\S]*?name: Detox release iOS E2E[\s\S]*?needs: \[detox_release_ui_shard, detox_release_safe_area_shard, detox_release_data_shard\][\s\S]*?if: \$\{\{ always\(\) \}\}/,
  );
  assert.match(releaseWorkflow, /require-detox-release-shard-aggregate\.mjs/);
  assert.match(profileWorkflow, /release_shard: \{ required: false, type: string, default: '' \}/);
  assert.match(profileWorkflow, /OROT_DETOX_RELEASE_SHARD: \$\{\{ inputs\.release_shard \}\}/);
  assert.equal(
    [...releaseWorkflow.matchAll(/fingerprints: \$\{\{ inputs\.fingerprints \}\}/g)].length,
    3,
  );
});
