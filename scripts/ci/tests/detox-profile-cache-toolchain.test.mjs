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

function workflowStep(name) {
  const start = profileWorkflow.indexOf(`- name: ${name}`);
  const end = profileWorkflow.indexOf('\n      - name:', start + 1);
  return start < 0 ? '' : profileWorkflow.slice(start, end < 0 ? undefined : end);
}

test('defers Ruby and CocoaPods setup until the validated cache requires a native build', () => {
  // Only a cache miss needs CocoaPods to recreate native products.
  const cachePreparation = profileWorkflow.indexOf(
    '- name: Prepare restored Detox DerivedData cache',
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

  assert.ok(baseToolchainIndex >= 0 && baseToolchainIndex < cachePreparation);
  assert.match(
    baseToolchain,
    /run: scripts\/ci\/verify-toolchain\.sh --skip-simulator-availability(?:\r?\n|$)/,
  );
  assert.doesNotMatch(baseToolchain, /--cocoapods/);
  assert.ok(cachePreparation >= 0 && cachePreparation < rubyIndex);
  assert.ok(rubyIndex < cocoapodsIndex && cocoapodsIndex < nativePodsIndex);
  assert.match(rubySetup, needsNativeBuild);
  assert.match(cocoapodsSetup, needsNativeBuild);
  assert.match(cacheRecord, /expected_ruby=/);
  assert.match(cacheRecord, /expected_cocoapods=/);
  assert.match(nativePods, /verify-toolchain\.sh --cocoapods/);
});
