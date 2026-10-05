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

test('restores React Native and exact app caches before the single Pods fallback', () => {
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
  const prepareCache = profileWorkflow.indexOf('- name: Prepare restored Detox DerivedData cache');
  const build = profileWorkflow.indexOf('- name: Build Detox iOS Simulator app');
  const buildEnd = profileWorkflow.indexOf('\n      - name:', build + 1);

  assert.ok(framework >= 0 && framework < rnFingerprint);
  assert.ok(
    rnFingerprint < rnCache &&
      rnCache < derivedFingerprint &&
      derivedFingerprint < derivedCache &&
      derivedCache < prepareCache &&
      prepareCache < pods &&
      pods < build,
  );
  assert.match(
    profileWorkflow.slice(rnFingerprint, rnCache),
    /detox-cache-fingerprint-cli\.mjs --react-native-artifacts-only/,
  );
  assert.match(profileWorkflow.slice(pods, build), /build-detox-apps\.sh pods/);
  assert.match(
    profileWorkflow.slice(build, buildEnd),
    /build-detox-apps\.sh "\$\{\{ inputs\.profile \}\}" --skip-pods/,
  );
});

test('keeps Detox and production DerivedData roots separate from CocoaPods Codegen output', () => {
  const releaseConfig = readFileSync(join(repositoryRoot, 'apps/mobile/.detoxrc.js'), 'utf8');
  const debugConfig = readFileSync(
    join(repositoryRoot, 'apps/mobile/e2e/openai-provider.detox.config.js'),
    'utf8',
  );
  const builder = readFileSync(join(repositoryRoot, 'scripts/ci/build-detox-apps.sh'), 'utf8');
  const cachePaths = readFileSync(
    join(repositoryRoot, 'scripts/ci/ios-derived-data-cache-paths.mjs'),
    'utf8',
  );
  const ciWorkflow = readFileSync(join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8');
  const gitignore = readFileSync(join(repositoryRoot, '.gitignore'), 'utf8');

  assert.match(releaseConfig, /\|\| 'ios\/build-detox-release'/);
  assert.match(debugConfig, /'ios\/build-detox-openai-provider'/);
  assert.match(builder, /OROT_DETOX_RELEASE_DERIVED_DATA_PATH:-ios\/build-detox-release/);
  assert.match(builder, /OROT_OPENAI_PROVIDER_DERIVED_DATA_PATH:-ios\/build-detox-openai-provider/);
  assert.match(cachePaths, /apps\/mobile\/ios\/build-detox-release/);
  assert.match(cachePaths, /apps\/mobile\/ios\/build-detox-openai-provider/);
  assert.match(cachePaths, /apps\/mobile\/ios\/build-production/);
  // The warm production app still needs Pods for signing and build-settings checks.
  assert.match(
    ciWorkflow,
    /path:\s+\|\n\s+apps\/mobile\/ios\/build-production\n\s+apps\/mobile\/ios\/Pods/,
  );
  assert.match(gitignore, /apps\/mobile\/ios\/build-detox-release\//);
  assert.match(gitignore, /apps\/mobile\/ios\/build-detox-openai-provider\//);
  assert.match(gitignore, /apps\/mobile\/ios\/build-production\//);
  assert.match(profileWorkflow, /orot-detox-deriveddata-v5-/);
});
