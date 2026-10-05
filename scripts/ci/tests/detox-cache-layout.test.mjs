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

test('restores React Native archives before the single Pods stage and DerivedData afterward', () => {
  const framework = profileWorkflow.indexOf('- name: Build Detox iOS framework cache');
  const rnFingerprint = profileWorkflow.indexOf(
    '- name: Compute React Native artifact fingerprint',
  );
  const rnCache = profileWorkflow.indexOf('- name: Cache React Native artifact archives');
  const pods = profileWorkflow.indexOf('- name: Install Detox CocoaPods dependencies');
  const derivedFingerprint = profileWorkflow.indexOf(
    '- name: Compute stable Detox cache fingerprints',
  );
  const derivedCache = profileWorkflow.indexOf('- name: Cache Release Detox DerivedData');
  const build = profileWorkflow.indexOf('- name: Build Detox iOS Simulator app');
  const buildEnd = profileWorkflow.indexOf('\n      - name:', build + 1);

  assert.ok(framework >= 0 && framework < rnFingerprint);
  assert.ok(rnFingerprint < rnCache && rnCache < pods);
  assert.ok(pods < derivedFingerprint && derivedFingerprint < derivedCache && derivedCache < build);
  assert.match(
    profileWorkflow.slice(rnFingerprint, rnCache),
    /detox-cache-fingerprint-cli\.mjs --react-native-artifacts-only/,
  );
  assert.match(profileWorkflow.slice(pods, derivedFingerprint), /build-detox-apps\.sh pods/);
  assert.match(
    profileWorkflow.slice(build, buildEnd),
    /build-detox-apps\.sh "\$\{\{ inputs\.profile \}\}" --skip-pods/,
  );
});

test('keeps Detox DerivedData roots separate from CocoaPods Codegen output', () => {
  const releaseConfig = readFileSync(join(repositoryRoot, 'apps/mobile/.detoxrc.js'), 'utf8');
  const debugConfig = readFileSync(
    join(repositoryRoot, 'apps/mobile/e2e/openai-provider.detox.config.js'),
    'utf8',
  );
  const builder = readFileSync(join(repositoryRoot, 'scripts/ci/build-detox-apps.sh'), 'utf8');
  const cacheHelper = readFileSync(
    join(repositoryRoot, 'scripts/ci/detox-derived-data-cache.mjs'),
    'utf8',
  );
  const gitignore = readFileSync(join(repositoryRoot, '.gitignore'), 'utf8');

  assert.match(releaseConfig, /\|\| 'ios\/build-detox-release'/);
  assert.match(debugConfig, /'ios\/build-detox-openai-provider'/);
  assert.match(builder, /OROT_DETOX_RELEASE_DERIVED_DATA_PATH:-ios\/build-detox-release/);
  assert.match(builder, /OROT_OPENAI_PROVIDER_DERIVED_DATA_PATH:-ios\/build-detox-openai-provider/);
  assert.match(cacheHelper, /apps\/mobile\/ios\/build-detox-release/);
  assert.match(cacheHelper, /apps\/mobile\/ios\/build-detox-openai-provider/);
  assert.match(gitignore, /apps\/mobile\/ios\/build-detox-release\//);
  assert.match(gitignore, /apps\/mobile\/ios\/build-detox-openai-provider\//);
  assert.match(profileWorkflow, /orot-detox-deriveddata-v3-/);
});
