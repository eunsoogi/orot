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
const recorder = readFileSync(
  join(repositoryRoot, 'scripts/ci/record-detox-cache-state.sh'),
  'utf8',
);

function workflowStep(name) {
  const start = profileWorkflow.indexOf(`- name: ${name}`);
  const end = profileWorkflow.indexOf('\n      - name:', start + 1);
  return start < 0 ? '' : profileWorkflow.slice(start, end < 0 ? undefined : end);
}

test('restores only an exact Detox framework cache and keeps a cold build path', () => {
  const prepareSimulator = profileWorkflow.indexOf('- name: Prepare dedicated Detox Simulator');
  const cacheIndex = profileWorkflow.indexOf('- name: Cache Detox framework outputs');
  const buildIndex = profileWorkflow.indexOf('- name: Build Detox iOS framework cache');
  const cache = workflowStep('Cache Detox framework outputs');
  const build = workflowStep('Build Detox iOS framework cache');

  assert.ok(prepareSimulator < cacheIndex && cacheIndex < buildIndex);
  assert.match(cache, /uses: actions\/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9/);
  assert.match(cache, /~\/Library\/Detox\/ios\/framework/);
  assert.match(cache, /~\/Library\/Detox\/ios\/xcuitest-runner/);
  assert.match(cache, /\$\{\{ runner\.os \}\}/);
  assert.match(cache, /\$\{\{ runner\.arch \}\}/);
  assert.match(cache, /steps\.verify_toolchain\.outputs\.macos_version/);
  assert.match(cache, /steps\.verify_toolchain\.outputs\.xcodebuild_fingerprint/);
  assert.match(cache, /hashFiles\('pnpm-lock\.yaml'\)/);
  assert.doesNotMatch(cache, /restore-keys:/);
  assert.match(build, /if:.*detox_framework_cache\.outputs\.cache-hit != 'true'/);
  assert.match(build, /pnpm --filter @orot\/mobile exec -- detox build-framework-cache/);
});

test('records the Detox framework cache decision with other CI cache evidence', () => {
  const record = workflowStep('Record Detox cache state');

  assert.match(
    record,
    /DETOX_FRAMEWORK_CACHE_HIT: \$\{\{ steps\.prepare_derived_data_cache\.outputs\.detox_artifacts_reusable == 'true' \|\| steps\.detox_framework_cache\.outputs\.cache-hit == 'true' \}\}/,
  );
  assert.match(
    record,
    /XCODEBUILD_FINGERPRINT: \$\{\{ steps\.verify_toolchain\.outputs\.xcodebuild_fingerprint \}\}/,
  );
  assert.match(recorder, /detox_framework_cache_hit=%s/);
  assert.match(recorder, /xcodebuild_fingerprint=%s/);
});
