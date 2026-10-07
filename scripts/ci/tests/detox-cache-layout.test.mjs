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

test('validates exact app caches before restoring optional native build inputs', () => {
  const framework = profileWorkflow.indexOf('- name: Build Detox iOS framework cache');
  const rnFingerprint = profileWorkflow.indexOf(
    '- name: Prepare React Native artifact cache fingerprint',
  );
  const rnCache = profileWorkflow.indexOf('- name: Cache React Native artifact archives');
  const pods = profileWorkflow.indexOf('- name: Install Detox CocoaPods dependencies');
  const derivedFingerprint = profileWorkflow.indexOf(
    '- name: Compute stable Detox cache fingerprints',
  );
  const derivedCache = profileWorkflow.indexOf('- name: Cache Detox profile app product');
  const prepareCache = profileWorkflow.indexOf('- name: Prepare restored Detox DerivedData cache');
  const build = profileWorkflow.indexOf('- name: Build Detox iOS Simulator app');
  const buildEnd = profileWorkflow.indexOf('\n      - name:', build + 1);

  assert.ok(derivedFingerprint >= 0 && derivedFingerprint < derivedCache);
  assert.ok(
    derivedCache < prepareCache &&
      prepareCache < framework &&
      framework < rnFingerprint &&
      rnFingerprint < rnCache &&
      rnCache < pods &&
      pods < build,
  );
  assert.equal(
    profileWorkflow.includes('- name: Compute React Native artifact fingerprint'),
    false,
  );
  const rnCacheEnd = profileWorkflow.indexOf('\n      - name:', rnCache + 1);
  const rnCacheStep = profileWorkflow.slice(rnCache, rnCacheEnd < 0 ? undefined : rnCacheEnd);
  assert.match(rnCacheStep, /orot-rn-ios-artifacts-v3-/);
  assert.match(rnCacheStep, /steps\.rn_artifact_fingerprint\.outputs\.fingerprint/);
  assert.doesNotMatch(rnCacheStep, /hashFiles\(/);
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
  const transcriptionConfig = readFileSync(
    join(repositoryRoot, 'apps/mobile/e2e/transcription.detox.config.js'),
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
  assert.match(transcriptionConfig, /OROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST/);
  assert.match(cachePaths, /apps\/mobile\/ios\/build-detox-transcription/);
  assert.match(
    builder,
    /OROT_SPEECH_TRANSCRIPTION_DERIVED_DATA_PATH:-ios\/build-detox-transcription/,
  );
  assert.match(cachePaths, /apps\/mobile\/ios\/build-production/);
  // The warm production app still needs Pods for signing and build-settings checks.
  assert.match(
    ciWorkflow,
    /path:\s+\|\n\s+apps\/mobile\/ios\/build-production\n\s+apps\/mobile\/ios\/Pods/,
  );
  assert.match(gitignore, /apps\/mobile\/ios\/build-detox-release\//);
  assert.match(gitignore, /apps\/mobile\/ios\/build-detox-openai-provider\//);
  assert.match(gitignore, /apps\/mobile\/ios\/build-detox-transcription\//);
  assert.match(gitignore, /apps\/mobile\/ios\/build-production\//);
  assert.match(profileWorkflow, /orot-detox-deriveddata-v9-/);
});
