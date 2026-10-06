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
const cacheStateRecorder = readFileSync(
  join(repositoryRoot, 'scripts/ci/record-detox-cache-state.sh'),
  'utf8',
);

function workflowStep(name) {
  const start = profileWorkflow.indexOf(`- name: ${name}`);
  const end = profileWorkflow.indexOf('\n      - name:', start + 1);
  return start < 0 ? '' : profileWorkflow.slice(start, end < 0 ? undefined : end);
}

test('installs CocoaPods once before fingerprinting the app cache', () => {
  const cachePreparation = profileWorkflow.indexOf(
    '- name: Prepare restored Detox DerivedData cache',
  );
  const simulatorPreparationIndex = profileWorkflow.indexOf(
    '- name: Prepare dedicated Detox Simulator',
  );
  const baseToolchain = workflowStep('Verify runner toolchain');
  const rubySetup = workflowStep('Set up Ruby');
  const cocoapodsSetup = workflowStep('Install CocoaPods');
  const cacheRecord = workflowStep('Record Detox cache state');
  const nativePods = workflowStep('Install Detox CocoaPods dependencies');
  const baseToolchainIndex = profileWorkflow.indexOf('- name: Verify runner toolchain');
  const rubyIndex = profileWorkflow.indexOf('- name: Set up Ruby');
  const cocoapodsIndex = profileWorkflow.indexOf('- name: Install CocoaPods');
  const nativePodsIndex = profileWorkflow.indexOf('- name: Install Detox CocoaPods dependencies');
  const needsNativeBuild = /steps\.prepare_derived_data_cache\.outputs\.app_reusable != 'true'/;

  assert.ok(baseToolchainIndex >= 0 && baseToolchainIndex < simulatorPreparationIndex);
  // Device availability enumeration can wait on an in-flight boot, so run it before requesting one.
  assert.match(baseToolchain, /run: scripts\/ci\/verify-toolchain\.sh(?:\r?\n|$)/);
  assert.doesNotMatch(baseToolchain, /--cocoapods/);
  const fingerprintIndex = profileWorkflow.indexOf(
    '- name: Compute stable Detox cache fingerprints',
  );
  assert.ok(rubyIndex >= 0 && cocoapodsIndex > rubyIndex && nativePodsIndex > cocoapodsIndex);
  assert.ok(nativePodsIndex < fingerprintIndex && fingerprintIndex < cachePreparation);
  assert.doesNotMatch(rubySetup, needsNativeBuild);
  assert.doesNotMatch(cocoapodsSetup, needsNativeBuild);
  assert.match(cacheRecord, /RUBY_VERSION: \$\{\{ env\.EXPECTED_RUBY_VERSION \}\}/);
  assert.match(cacheRecord, /COCOAPODS_VERSION: \$\{\{ env\.EXPECTED_COCOAPODS_VERSION \}\}/);
  assert.match(cacheStateRecorder, /expected_ruby=/);
  assert.match(cacheStateRecorder, /expected_cocoapods=/);
  assert.match(nativePods, /verify-toolchain\.sh --cocoapods/);
});
