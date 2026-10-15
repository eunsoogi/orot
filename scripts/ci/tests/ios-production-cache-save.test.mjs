import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

// Parse the real action with the existing pinned parser; actual cache transfer and reuse still require Actions evidence.
const require = createRequire(resolve('package.json'));
const yaml = createRequire(require.resolve('eslint/package.json'))('js-yaml');

test('only verified production outputs are cached before later integration or UI failures', () => {
  const action = yaml.load(
    readFileSync('.github/actions/ios-test-products-build/action.yml', 'utf8'),
  );
  const steps = action.runs.steps;
  const restores = steps.filter((step) => step.uses?.startsWith('actions/cache/restore@'));
  const saves = steps.filter((step) => step.uses?.startsWith('actions/cache/save@'));
  assert.equal(
    restores.length,
    1,
    'Production restoration must not depend on a job-success post-save',
  );
  assert.equal(saves.length, 1, 'Verified production outputs need an explicit early save');
  const [restore] = restores;
  const [save] = saves;
  const pinned = '55cc8345863c7cc4c66a329aec7e433d2d1c52a9';
  assert.equal(restore.uses, 'actions/cache/restore@' + pinned);
  assert.equal(save.uses, 'actions/cache/save@' + pinned);
  assert.equal(restore.id, 'production_cache_restore');
  assert.equal(restore.if, "inputs.production_build == 'true'");
  // Upstream failures and non-production jobs cannot save. Exact hits are immutable; misses and prefix hits use the requested key.
  assert.equal(
    save.if,
    "success() && inputs.production_build == 'true' && steps.production_cache_restore.outputs.cache-hit != 'true'",
  );
  assert.equal(save.with.key, '${{ steps.production_cache_restore.outputs.cache-primary-key }}');
  assert.equal(save.with.path, restore.with.path);
  assert.deepEqual(save.with.path.trim().split('\n'), [
    'apps/mobile/ios/build-production',
    'apps/mobile/ios/Pods',
  ]);
  assert.equal(restore.with['save-always'], undefined);
  assert.equal(save.with['save-always'], undefined);
  const position = (command) => steps.findIndex((step) => step.run?.includes(command));
  const saveIndex = steps.indexOf(save);
  assert.ok(steps.indexOf(restore) < position('ios-derived-data-cache.mjs prepare production'));
  for (const command of [
    'verify-toolchain.sh --cocoapods',
    'ios-test-source-inputs.mjs',
    'ios-derived-data-cache.mjs write production',
    'verify-apple-model-product.mjs production',
    'verify-simulator-keychain-defaults.mjs',
    'swift test --package-path packages/provider-openai',
    'ios-oauth-build',
    'ios-production-receipt.mjs write',
  ]) {
    const index = position(command);
    assert.ok(index >= 0 && index < saveIndex, command + ' must succeed before cache publication');
    assert.equal(steps[index]['continue-on-error'], undefined);
  }
  assert.ok(
    saveIndex < position('build-ios-tests.mjs'),
    'Later test-product compilation must not govern the production save',
  );
  assert.equal(save['continue-on-error'], undefined);
});
