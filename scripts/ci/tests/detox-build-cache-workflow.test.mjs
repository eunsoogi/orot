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

test('forces Release bundling and keeps the complete native build as the cache-miss fallback', () => {
  const releaseDetoxConfig = readFileSync(join(repositoryRoot, 'apps/mobile/.detoxrc.js'), 'utf8');
  const fingerprintConfigSource = readFileSync(
    join(repositoryRoot, 'scripts/ci/detox-build-config-fingerprint.mjs'),
    'utf8',
  );
  const buildStep = profileWorkflow.slice(
    profileWorkflow.indexOf('- name: Build Detox iOS Simulator app'),
    profileWorkflow.indexOf(
      '\n      - name:',
      profileWorkflow.indexOf('- name: Build Detox iOS Simulator app') + 1,
    ),
  );
  assert.match(releaseDetoxConfig, /FORCE_BUNDLING=1 xcodebuild/);
  assert.match(fingerprintConfigSource, /ENTRY_FILE\|FORCE_BUNDLING/);
  assert.match(buildStep, /app_reusable != 'true'/);
  assert.match(buildStep, /build-detox-apps\.sh/);
});
