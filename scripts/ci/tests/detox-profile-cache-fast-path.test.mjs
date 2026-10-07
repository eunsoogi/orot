import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const workflow = readFileSync(
  join(repositoryRoot, '.github/workflows/detox-e2e-profile.yml'),
  'utf8',
);

function step(name) {
  const start = workflow.indexOf(`- name: ${name}`);
  const end = workflow.indexOf('\n      - name:', start + 1);
  return start < 0 ? '' : workflow.slice(start, end < 0 ? undefined : end);
}

test('validates the profile app cache before optional native dependency preparation', () => {
  const fingerprints = workflow.indexOf('- name: Compute stable Detox cache fingerprints');
  const cache = workflow.indexOf('- name: Cache Detox profile app product');
  const prepare = workflow.indexOf('- name: Prepare restored Detox DerivedData cache');
  const framework = workflow.indexOf('- name: Cache Detox framework outputs');
  const pods = workflow.indexOf('- name: Install Detox CocoaPods dependencies');
  const build = workflow.indexOf('- name: Build Detox iOS Simulator app');
  const tests = workflow.indexOf('- name: Run Detox iOS Simulator tests');

  assert.ok(fingerprints < cache && cache < prepare && prepare < framework && framework < pods);
  assert.ok(pods < build && build < tests);
  // The v10 namespace prevents restoring older caches that included all Xcode build products.
  assert.match(step('Cache Detox profile app product'), /orot-detox-app-product-v10-/);
  assert.match(step('Cache Detox profile app product'), /xcodebuild_fingerprint/);
  assert.match(step('Cache Detox profile app product'), /~\/Library\/Detox\/ios\/framework/);
  assert.match(step('Cache Detox profile app product'), /~\/Library\/Detox\/ios\/xcuitest-runner/);
  assert.match(step('Compute stable Detox cache fingerprints'), /timeout-minutes: 5/);
  assert.match(step('Prepare restored Detox DerivedData cache'), /timeout-minutes: 5/);
  assert.match(step('Write Detox DerivedData cache manifest'), /timeout-minutes: 5/);
});

test('skips build-only setup on an exact validated cache and keeps tests unconditional', () => {
  const cacheMiss = /steps\.prepare_derived_data_cache\.outputs\.app_reusable != 'true'/;
  for (const name of [
    'Cache Detox framework outputs',
    'Cache React Native artifact archives',
    'Set up Ruby',
    'Cache Detox CocoaPods intermediates',
    'Install CocoaPods',
    'Install Detox CocoaPods dependencies',
    'Build Detox iOS Simulator app',
  ]) {
    assert.match(step(name), cacheMiss, `${name} must preserve the full miss path`);
  }
  assert.doesNotMatch(step('Run Detox iOS Simulator tests'), /if:/);
  assert.match(step('Write Detox DerivedData cache manifest'), /app_reusable != 'true'/);
});
