import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { computeDetoxCacheFingerprints } from '../detox-cache-fingerprint.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const cacheAction = readFileSync(
  join(repositoryRoot, '.github/actions/detox-cocoapods-cache/action.yml'),
  'utf8',
);
const fingerprintCli = join(repositoryRoot, 'scripts/ci/detox-cache-fingerprint-cli.mjs');
const profileWorkflow = readFileSync(
  join(repositoryRoot, '.github/workflows/detox-e2e-profile.yml'),
  'utf8',
);

test('keys CocoaPods intermediates by pinned toolchain and native source fingerprints', () => {
  const podsCache = cacheAction.slice(cacheAction.indexOf('id: cocoapods_cache'));

  for (const path of [
    'apps/mobile/ios/Pods',
    'apps/mobile/ios/build/generated',
    '~/Library/Caches/CocoaPods',
  ]) {
    assert.ok(podsCache.includes(path));
  }
  for (const input of [
    'inputs.cache-context',
    'outputs.native_dependencies',
    'outputs.build_inputs',
  ]) {
    assert.ok(podsCache.includes(input), 'cache key is missing ' + input);
  }
  assert.doesNotMatch(podsCache, /restore-keys:/);
  assert.equal(podsCache.includes('inputs.profile'), false);
});

test('restores only intermediate files and still runs CocoaPods before app fingerprinting', () => {
  const cacheStep = profileWorkflow.indexOf('- name: Cache Detox CocoaPods intermediates');
  const podsStep = profileWorkflow.indexOf('- name: Install Detox CocoaPods dependencies');
  const fingerprintStep = profileWorkflow.indexOf(
    '- name: Compute stable Detox cache fingerprints',
  );
  const derivedDataCache = profileWorkflow.indexOf('- name: Cache Detox profile app product');
  const podsBlock = profileWorkflow.slice(
    podsStep,
    profileWorkflow.indexOf('\n      - name:', podsStep + 1),
  );

  assert.ok(cacheStep >= 0 && cacheStep < podsStep);
  assert.ok(podsStep < fingerprintStep && fingerprintStep < derivedDataCache);
  assert.ok(profileWorkflow.includes('./.github/actions/detox-cocoapods-cache'));
  assert.ok(profileWorkflow.includes('cocoapods_intermediates_cache_hit'));
  for (const toolchainValue of [
    'runner.os',
    'runner.arch',
    'EXPECTED_MACOS_VERSION',
    'EXPECTED_NODE_VERSION',
    'EXPECTED_PNPM_VERSION',
    'EXPECTED_RUBY_VERSION',
    'EXPECTED_COCOAPODS_VERSION',
    'EXPECTED_XCODE_VERSION',
    'EXPECTED_IOS_SIMULATOR_SDK',
  ]) {
    assert.ok(profileWorkflow.includes(toolchainValue));
  }
  assert.doesNotMatch(podsBlock, /if:/);
});

test('pre-Pods fingerprint mode reports build inputs without setting post-install expectations', () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'orot-pods-cache-fingerprint-'));
  const outputPath = join(temporaryDirectory, 'github-output');
  const environmentPath = join(temporaryDirectory, 'github-environment');

  try {
    execFileSync(process.execPath, [fingerprintCli, '--cocoapods-cache-inputs-only'], {
      cwd: repositoryRoot,
      env: { ...process.env, GITHUB_OUTPUT: outputPath, GITHUB_ENV: environmentPath },
      stdio: 'pipe',
    });
    const output = readFileSync(outputPath, 'utf8');
    const fingerprints = computeDetoxCacheFingerprints();

    assert.ok(output.includes('build_inputs=' + fingerprints.buildInputs));
    assert.ok(output.includes('native_dependencies=' + fingerprints.nativeDependencies));
    assert.equal(existsSync(environmentPath), false);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
