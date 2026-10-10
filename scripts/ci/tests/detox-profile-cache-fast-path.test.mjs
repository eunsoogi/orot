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
const restoreAction = readFileSync(
  join(repositoryRoot, '.github/actions/detox-profile-app-cache/restore/action.yml'),
  'utf8',
);
const saveAction = readFileSync(
  join(repositoryRoot, '.github/actions/detox-profile-app-cache/save/action.yml'),
  'utf8',
);

function cachePathBlock(action) {
  const start = action.indexOf('        path: |\n');
  const end = action.indexOf('\n        key:', start);
  return start < 0 || end < 0 ? '' : action.slice(start, end);
}

function step(name) {
  const start = workflow.indexOf(`- name: ${name}`);
  const end = workflow.indexOf('\n      - name:', start + 1);
  return start < 0 ? '' : workflow.slice(start, end < 0 ? undefined : end);
}

test('resolves validated fingerprints before optional native dependency preparation', () => {
  const cache = workflow.indexOf('- name: Cache Detox profile app product');
  const resolver = workflow.indexOf(
    'node scripts/ci/detox-cache-fingerprint-cli.mjs --resolve-shared-derived-data-only',
  );
  const prepare = workflow.indexOf('- name: Prepare restored Detox DerivedData cache');
  const framework = workflow.indexOf('- name: Cache Detox framework outputs');
  const pods = workflow.indexOf('- name: Install Detox CocoaPods dependencies');
  const build = workflow.indexOf('- name: Build Detox iOS Simulator app');
  const tests = workflow.indexOf('- name: Run Detox iOS Simulator tests');

  const appCacheRestore = restoreAction.indexOf('- name: Restore Detox profile app product');

  // Missing helper outputs are computed locally before the profile cache key is assembled.
  assert.ok(resolver >= 0 && resolver < cache);
  assert.match(
    workflow,
    /fingerprints: \$\{\{ steps\.prepare_detox_simulator\.outputs\.fingerprints \}\}/,
  );
  assert.doesNotMatch(restoreAction, /Publish shared Detox cache fingerprints/);
  assert.doesNotMatch(restoreAction, /detox-cache-fingerprint-cli\.mjs/);
  assert.ok(appCacheRestore >= 0);
  for (const field of [
    'build_inputs',
    'native_dependencies',
    'privacy_manifest_input_sha256',
    'cocoapods_project_input_sha256',
  ]) {
    assert.ok(restoreAction.includes(`value: \${{ fromJSON(inputs.fingerprints).${field} }}`));
  }
  assert.ok(cache >= 0 && cache < prepare && prepare < framework && framework < pods);
  assert.ok(pods < build && build < tests);
  // The v10 namespace prevents restoring older caches that included all Xcode build products.
  assert.match(step('Cache Detox profile app product'), /orot-detox-app-product-v10-/);
  assert.match(step('Cache Detox profile app product'), /xcodebuild_fingerprint/);
  assert.match(restoreAction, /~\/Library\/Detox\/ios\/framework/);
  assert.match(restoreAction, /~\/Library\/Detox\/ios\/xcuitest-runner/);
  assert.match(step('Cache Detox profile app product'), /timeout-minutes: 10/);
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

test('saves validated app products before E2E tests can fail the job', () => {
  const restore = step('Cache Detox profile app product');
  const manifestIndex = workflow.indexOf('- name: Write Detox DerivedData cache manifest');
  const saveIndex = workflow.indexOf('- name: Save validated Detox profile app product');
  const testIndex = workflow.indexOf('- name: Run Detox iOS Simulator tests');
  const save = step('Save validated Detox profile app product');

  assert.ok(restore.includes('uses: ./.github/actions/detox-profile-app-cache/restore'));
  assert.match(restoreAction, /uses: actions\/cache\/restore@[0-9a-f]{40}/);
  assert.ok(
    restoreAction.includes('value: ${{ steps.profile_app_cache.outputs.cache-hit }}') &&
      restoreAction.includes('value: ${{ steps.profile_app_cache.outputs.cache-primary-key }}'),
  );
  const restoreRef = restoreAction.match(/actions\/cache\/restore@([0-9a-f]{40})/);
  const saveRef = saveAction.match(/actions\/cache\/save@([0-9a-f]{40})/);
  assert.ok(restoreRef && saveRef);
  assert.equal(restoreRef[1], saveRef[1]);
  assert.ok(manifestIndex < saveIndex && saveIndex < testIndex);
  assert.ok(save.includes('uses: ./.github/actions/detox-profile-app-cache/save'));
  assert.match(saveAction, /uses: actions\/cache\/save@[0-9a-f]{40}/);
  assert.ok(saveAction.includes("if: ${{ inputs.key != '' }}"));
  const restorePath = cachePathBlock(restoreAction);
  const savePath = cachePathBlock(saveAction);
  assert.equal(restorePath, savePath, 'restore and save must use the same cache allowlist');
  const saveKey = save.match(/^\s+key:\s*(.+)$/m)?.[1];
  // Bind the truth table to the actual workflow expression so OR cannot weaken either guard.
  assert.equal(
    saveKey,
    "${{ steps.profile_derived_data_cache.outputs.cache-hit != 'true' && steps.write_derived_data_cache.outcome == 'success' && steps.profile_derived_data_cache.outputs.cache-primary-key || '' }}",
  );
  const saveKeyCases = [
    {
      cacheHit: 'false',
      manifestOutcome: 'success',
      primaryKey: 'profile-key',
      expected: 'profile-key',
    },
    { cacheHit: 'true', manifestOutcome: 'success', primaryKey: 'profile-key', expected: '' },
    { cacheHit: 'false', manifestOutcome: 'failure', primaryKey: 'profile-key', expected: '' },
    { cacheHit: 'false', manifestOutcome: 'skipped', primaryKey: 'profile-key', expected: '' },
    { cacheHit: 'false', manifestOutcome: 'success', primaryKey: '', expected: '' },
  ];
  for (const { cacheHit, manifestOutcome, primaryKey, expected } of saveKeyCases) {
    const key = cacheHit !== 'true' && manifestOutcome === 'success' ? primaryKey : '';
    assert.equal(key, expected);
  }
});
