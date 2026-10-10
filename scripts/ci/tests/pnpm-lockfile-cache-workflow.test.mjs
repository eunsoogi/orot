import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

function requireCacheInWorkflow(relativePath, expectedCount) {
  const source = readFileSync(join(repositoryRoot, relativePath), 'utf8');
  const installs = [...source.matchAll(/pnpm install --frozen-lockfile/g)].map(
    (match) => match.index,
  );
  const nodeSetupSteps = [...source.matchAll(/- name: Set up Node\.js/g)].map(
    (match) => match.index,
  );
  const cacheSteps = [...source.matchAll(/- name: Cache pnpm lockfile verification/g)].map(
    (match) => match.index,
  );
  const action = readFileSync(
    join(repositoryRoot, '.github/actions/pnpm-lockfile-verification/action.yml'),
    'utf8',
  );

  assert.equal(cacheSteps.length, expectedCount, `${relativePath} cache step count`);
  for (const install of installs) {
    const cache = cacheSteps.filter((index) => index < install).at(-1);
    const nodeSetup = nodeSetupSteps.filter((index) => index < cache).at(-1);
    assert.ok(nodeSetup !== undefined && nodeSetup < cache && cache < install);
  }
  // Reuse only pnpm's verified lockfile record for this workspace policy and toolchain.
  assert.match(action, /actions\/cache@[0-9a-f]{40}/);
  assert.match(action, /orot-pnpm-cache\/lockfile-verified\.jsonl/);
  assert.match(action, /runner\.os.*runner\.arch.*inputs\.pnpm-version/s);
  assert.match(action, /pnpm-lock\.yaml.*pnpm-workspace\.yaml.*\.npmrc.*package\.json/s);
  assert.match(action, /PNPM_CONFIG_CACHE_DIR=/);
  assert.match(action, /PNPM_CONFIG_STORE_DIR=.*pnpm store path/);
  assert.doesNotMatch(action, /orot-pnpm-cache\/store|path:.*node_modules/);
}

test('caches pnpm policy verification in each independent dependency-install job', () => {
  requireCacheInWorkflow('.github/workflows/e2e-test.yml', 1);
  requireCacheInWorkflow('.github/workflows/code-quality.yml', 2);
  requireCacheInWorkflow('.github/workflows/unit-test.yml', 2);
  requireCacheInWorkflow('.github/workflows/policy-check.yml', 1);
  requireCacheInWorkflow('.github/workflows/detox-e2e-profile.yml', 1);
});
