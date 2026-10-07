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
  for (const profile of ['release', 'openai-provider', 'transcription']) {
    assert.match(profilesWorkflow, new RegExp(`profile: ${profile.replace('-', '\\-')}`));
  }
  assert.match(
    profilesWorkflow,
    /needs: \[detox_release_e2e, detox_openai_provider_e2e, detox_transcription_e2e\]/,
  );
  assert.match(profilesWorkflow, /if: \$\{\{ always\(\) \}\}/);
  assert.match(profilesWorkflow, /require-detox-e2e-aggregate\.mjs/);
  assert.match(profilesWorkflow, /require-detox-transcription-aggregate\.mjs/);
});
