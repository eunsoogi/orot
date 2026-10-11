import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

function assertLockfileCache(action) {
  // Cache only the verified lockfile record, keyed by the inputs that determine pnpm policy.
  assert.match(action, /actions\/cache@[0-9a-f]{40}/);
  assert.match(action, /orot-pnpm-cache\/lockfile-verified\.jsonl/);
  assert.match(action, /runner\.os.*runner\.arch.*inputs\.pnpm-version/s);
  assert.match(action, /pnpm-lock\.yaml.*pnpm-workspace\.yaml.*\.npmrc.*package\.json/s);
  assert.match(action, /PNPM_CONFIG_CACHE_DIR=/);
  assert.match(action, /PNPM_CONFIG_STORE_DIR=.*pnpm store path/);
  assert.doesNotMatch(action, /orot-pnpm-cache\/store|path:.*node_modules/);
}

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
  assertLockfileCache(action);
}

function requireCacheInAction(relativePath) {
  const source = readFileSync(join(repositoryRoot, relativePath), 'utf8');
  const lockfileAction = readFileSync(
    join(repositoryRoot, '.github/actions/pnpm-lockfile-verification/action.yml'),
    'utf8',
  );
  const installs = [...source.matchAll(/pnpm install --frozen-lockfile/g)].map(
    (match) => match.index,
  );
  const nodeSetup = source.indexOf('- name: Set up Node.js');
  const cache = source.indexOf('- name: Cache pnpm lockfile verification');

  assert.equal(installs.length, 1, `${relativePath} install count`);
  assert.ok(nodeSetup >= 0 && nodeSetup < cache && cache < installs[0]);
  assert.match(source, /uses: \.\/\.github\/actions\/pnpm-lockfile-verification/);
  assertLockfileCache(lockfileAction);
}

test('caches pnpm policy verification in each independent dependency-install job', () => {
  requireCacheInWorkflow('.github/workflows/e2e-test.yml', 1);
  requireCacheInWorkflow('.github/workflows/unit-test.yml', 2);
  requireCacheInWorkflow('.github/workflows/policy-check.yml', 1);
  requireCacheInWorkflow('.github/workflows/detox-e2e-profile.yml', 1);

  const codeQuality = readFileSync(
    join(repositoryRoot, '.github/workflows/code-quality.yml'),
    'utf8',
  );
  const qualitySurfaceAction = readFileSync(
    join(repositoryRoot, '.github/actions/run-quality-surface/action.yml'),
    'utf8',
  );
  const qualitySetupAction = '.github/actions/setup-linux-quality/action.yml';
  const qualitySetupUsers = (
    codeQuality.match(/uses: \.\/\.github\/actions\/setup-linux-quality/g) ?? []
  ).length;
  const qualitySurfaceUsers = (
    codeQuality.match(/uses: \.\/\.github\/actions\/run-quality-surface/g) ?? []
  ).length;

  // Static lint leaves share one setup action, so verify its transitive cache-before-install path once.
  assert.equal(qualitySurfaceUsers, 10);
  assert.equal(qualitySetupUsers, 1);
  assert.match(qualitySurfaceAction, /uses: \.\/\.github\/actions\/setup-linux-quality/);
  requireCacheInAction(qualitySetupAction);
});
