import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const ciWorkflow = readFileSync(join(repositoryRoot, '.github/workflows/e2e-test.yml'), 'utf8');
const mobilePackage = readFileSync(join(repositoryRoot, 'apps/mobile/package.json'), 'utf8');

function workflowStep(source, name) {
  const start = source.indexOf('- name: ' + name);
  const end = source.indexOf('\n      - name:', start + 1);
  return start < 0 ? '' : source.slice(start, end < 0 ? undefined : end);
}

test('reuses only the exact production app while selected iOS paths run OAuth checks', () => {
  const fingerprint = workflowStep(ciWorkflow, 'Compute production app cache fingerprints');
  const verifyToolchain = workflowStep(ciWorkflow, 'Verify runner toolchain');
  const cache = workflowStep(ciWorkflow, 'Cache production app DerivedData and CocoaPods');
  const prepare = workflowStep(ciWorkflow, 'Prepare production app DerivedData cache');
  const pods = workflowStep(ciWorkflow, 'Install app CocoaPods dependencies');
  const build = workflowStep(ciWorkflow, 'Build the iOS Simulator app');
  const writeManifest = workflowStep(ciWorkflow, 'Write production app DerivedData manifest');
  const signingAndOAuth = workflowStep(
    ciWorkflow,
    'Verify Simulator defaults and test OAuth package',
  );
  const oauthBuild = workflowStep(
    ciWorkflow,
    'Build the standalone ChatGPT OAuth Simulator harness',
  );

  assert.doesNotMatch(ciWorkflow, /EXPECTED_MACOS_VERSION/);
  const indices = [
    ciWorkflow.indexOf('- name: Compute production app cache fingerprints'),
    ciWorkflow.indexOf('- name: Cache production app DerivedData and CocoaPods'),
    ciWorkflow.indexOf('- name: Prepare production app DerivedData cache'),
    ciWorkflow.indexOf('- name: Install app CocoaPods dependencies'),
    ciWorkflow.indexOf('- name: Build the iOS Simulator app'),
  ];
  assert.ok(
    indices.every(
      (index, position) => index >= 0 && (position === 0 || index > indices[position - 1]),
    ),
  );
  assert.match(fingerprint, /--derived-data-only/);
  assert.match(
    cache,
    /path:\s+\|\n\s+apps\/mobile\/ios\/build-production\n\s+apps\/mobile\/ios\/Pods/,
  );
  assert.match(cache, /key: orot-ios-app-deriveddata-v5-/);
  assert.match(cache, /restore-keys: orot-ios-app-deriveddata-v5-/);
  assert.match(
    cache,
    /key:.*macos-\$\{\{\s*steps\.verify_toolchain\.outputs\.macos_version\s*\}\}/,
  );
  assert.match(
    cache,
    /restore-keys:.*macos-\$\{\{\s*steps\.verify_toolchain\.outputs\.macos_version\s*\}\}/,
  );
  assert.match(
    cache,
    /restore-keys:.*-xcode-\$\{\{\s*env\.EXPECTED_XCODE_VERSION\s*\}\}-build-\$\{\{\s*steps\.verify_toolchain\.outputs\.xcodebuild_fingerprint\s*\}\}/,
  );
  assert.match(
    prepare,
    /MACOS_VERSION: \$\{\{\s*steps\.verify_toolchain\.outputs\.macos_version\s*\}\}/,
  );
  assert.match(
    writeManifest,
    /MACOS_VERSION: \$\{\{\s*steps\.verify_toolchain\.outputs\.macos_version\s*\}\}/,
  );
  assert.match(cache, /xcodebuild_fingerprint/);
  assert.ok(
    ciWorkflow.indexOf('- name: Verify runner toolchain') <
      ciWorkflow.indexOf('- name: Prepare production app DerivedData cache'),
  );
  assert.match(
    verifyToolchain,
    /id: verify_toolchain[\s\S]*run: scripts\/ci\/verify-toolchain\.sh --cocoapods/,
  );
  // The iOS build leaf may skip setup only after the required selector completes successfully.
  assert.match(verifyToolchain, /if: \$\{\{ steps\.select\.outputs\.ios_build == 'true' \}\}/);
  assert.doesNotMatch(prepare, /XCODEBUILD_FINGERPRINT:/);
  assert.doesNotMatch(writeManifest, /XCODEBUILD_FINGERPRINT:/);
  assert.match(prepare, /detox-derived-data-cache\.mjs prepare production/);
  for (const step of [prepare, writeManifest]) {
    assert.match(
      step,
      /set -o pipefail; node scripts\/ci\/detox-derived-data-cache\.mjs[^\n]*\| tee/,
    );
  }
  assert.match(pods, /app_reusable != 'true'/);
  assert.match(build, /app_reusable != 'true'/);
  // Cache hits skip only the app build; selected iOS changes still run OAuth validation.
  assert.match(signingAndOAuth, /if: \$\{\{ steps\.select\.outputs\.ios_build == 'true' \}\}/);
  assert.doesNotMatch(signingAndOAuth, /app_reusable/);
  assert.match(signingAndOAuth, /node scripts\/ci\/verify-simulator-keychain-defaults\.mjs &&/);
  assert.match(signingAndOAuth, /run-command\.sh openai-oauth-tests/);
  assert.match(oauthBuild, /if: \$\{\{ steps\.select\.outputs\.ios_build == 'true' \}\}/);
  assert.doesNotMatch(oauthBuild, /app_reusable/);
  assert.match(mobilePackage, /"ios:build"[\s\S]*?ios\/build/);
});
