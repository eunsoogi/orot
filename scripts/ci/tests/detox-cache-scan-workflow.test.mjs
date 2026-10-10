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
const manifestFingerprintSource = readFileSync(
  join(repositoryRoot, 'scripts/ci/detox-cache-manifest-fingerprints.mjs'),
  'utf8',
);
const profileDependencySetup = readFileSync(
  join(repositoryRoot, 'scripts/ci/install-detox-profile-dependencies.sh'),
  'utf8',
);

test('overlaps the post-install build-input scan with dedicated Simulator and app-cache setup', () => {
  const installIndex = profileWorkflow.indexOf(
    '- name: Install dependencies and check Speech readiness',
  );
  const simulatorIndex = profileWorkflow.indexOf('- name: Prepare dedicated Detox Simulator');
  const appCacheIndex = profileWorkflow.indexOf('- name: Cache Detox profile app product');
  const prepareIndex = profileWorkflow.indexOf('- name: Prepare restored Detox DerivedData cache');
  const installStart = profileWorkflow.indexOf(
    '- name: Install dependencies and check Speech readiness',
  );
  const installEnd = profileWorkflow.indexOf('\n      - name:', installStart + 1);
  const installStep = profileWorkflow.slice(installStart, installEnd);

  assert.ok(installIndex >= 0 && simulatorIndex < appCacheIndex && appCacheIndex < prepareIndex);
  assert.match(installStep, /scripts\/ci\/install-detox-profile-dependencies\.sh/);
  assert.ok(
    profileDependencySetup.indexOf('pnpm install --frozen-lockfile') <
      profileDependencySetup.indexOf('run-command.sh speech-readiness-regression') &&
      profileDependencySetup.indexOf('run-command.sh speech-readiness-regression') <
        profileDependencySetup.indexOf('start-detox-build-input-scan.sh'),
  );
  assert.match(manifestFingerprintSource, /DETOX_CACHE_BUILD_INPUTS_SCAN_PATH/);
});
