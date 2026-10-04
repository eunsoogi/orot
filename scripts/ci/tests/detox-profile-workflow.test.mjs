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
const ciWorkflow = readFileSync(join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8');
const runner = readFileSync(join(repositoryRoot, 'scripts/ci/run-detox-e2e.sh'), 'utf8');

test('keeps profile build, Simulator lifecycle, E2E, failure diagnostics, cleanup and upload in order', () => {
  const build = profileWorkflow.indexOf('- name: Build Detox iOS Simulator app');
  const prepare = profileWorkflow.indexOf('- name: Prepare dedicated Detox Simulator');
  const boot = profileWorkflow.indexOf('- name: Wait for dedicated Detox Simulator');
  const tests = profileWorkflow.indexOf('- name: Run Detox iOS Simulator tests');
  const diagnostics = profileWorkflow.indexOf('- name: Collect simulator logs');
  const teardown = profileWorkflow.indexOf('- name: Delete dedicated Detox Simulator');
  const upload = profileWorkflow.indexOf(
    '- name: Upload Detox reports, logs, screenshots, and videos',
  );
  const testStepStart = profileWorkflow.indexOf('- name: Run Detox iOS Simulator tests');
  const testStepEnd = profileWorkflow.indexOf('\n      - name:', testStepStart + 1);
  const testStep = profileWorkflow.slice(testStepStart, testStepEnd);

  assert.ok(build >= 0 && prepare > build && boot > prepare && tests > boot);
  assert.ok(diagnostics > tests && teardown > diagnostics && upload > teardown);
  assert.match(testStep, /timeout-minutes: 45/);
  assert.match(testStep, /run: scripts\/ci\/run-test-suite\.sh/);
  assert.match(profileWorkflow, /if: \$\{\{ always\(\) \}\}/);
  assert.doesNotMatch(profileWorkflow, /mdutil|Spotlight|spotlight/i);
  assert.doesNotMatch(ciWorkflow, /mdutil|Spotlight|spotlight/i);
});

test('leaves heavy resource sampling off unless a manual run requests it and caps samples', () => {
  assert.match(
    ciWorkflow,
    /workflow_dispatch:[\s\S]*?detox_resource_sampling:[\s\S]*?type: boolean[\s\S]*?default: false/,
  );
  assert.match(
    ciWorkflow,
    /if \[\[ "\$GITHUB_EVENT_NAME" == workflow_dispatch \]\]; then[\s\S]*?scripts\/ci\/check-loc\.mjs --all[\s\S]*?else[\s\S]*?scripts\/ci\/check-loc\.mjs --base "\$LOC_BASE_SHA"/,
  );
  assert.match(
    profileWorkflow,
    /resource_sampling:[\s\S]*?required: false[\s\S]*?type: boolean[\s\S]*?default: false/,
  );
  assert.equal(
    (
      ciWorkflow.match(
        /resource_sampling: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.detox_resource_sampling == true \}\}/g,
      ) || []
    ).length,
    2,
  );
  assert.match(
    profileWorkflow,
    /OROT_DETOX_RESOURCE_SAMPLING: \$\{\{ inputs\.resource_sampling \}\}/,
  );
  assert.match(runner, /resource_sample_limit=4/);
  assert.match(runner, /sample_index < resource_sample_limit/);
});

test('runs Release and OpenAI Debug in independent jobs behind a fail-closed aggregate check', () => {
  const releaseCall = ciWorkflow.slice(
    ciWorkflow.indexOf('  detox_release_e2e:'),
    ciWorkflow.indexOf('  detox_openai_provider_e2e:'),
  );
  const debugCall = ciWorkflow.slice(
    ciWorkflow.indexOf('  detox_openai_provider_e2e:'),
    ciWorkflow.indexOf('  detox_ios_e2e:'),
  );
  const aggregate = ciWorkflow.slice(ciWorkflow.indexOf('  detox_ios_e2e:'));
  assert.match(releaseCall, /uses: \.\/\.github\/workflows\/detox-e2e-profile\.yml/);
  assert.match(releaseCall, /profile: release/);
  assert.match(debugCall, /uses: \.\/\.github\/workflows\/detox-e2e-profile\.yml/);
  assert.match(debugCall, /profile: openai-provider/);
  assert.match(aggregate, /name: Detox iOS E2E/);
  assert.match(aggregate, /needs:\s*\[detox_release_e2e, detox_openai_provider_e2e\]/);
  assert.match(aggregate, /if: \$\{\{ always\(\) \}\}/);
  assert.match(aggregate, /require-detox-e2e-aggregate\.mjs/);
  assert.match(profileWorkflow, /runs-on: xcode-27/);
  assert.match(profileWorkflow, /build-detox-apps\.sh "\$\{\{ inputs\.profile \}\}"/);
  assert.match(profileWorkflow, /run-test-suite\.sh "e2e-\$\{\{ inputs\.profile \}\}"/);
});

test('keys native dependency and per-profile DerivedData caches by the exact toolchain and build inputs', () => {
  const fingerprintSource = readFileSync(
    join(repositoryRoot, 'scripts/ci/detox-cache-fingerprint.mjs'),
    'utf8',
  );
  const getStep = (name) => {
    const start = profileWorkflow.indexOf(`- name: ${name}`);
    const end = profileWorkflow.indexOf('\n      - name:', start + 1);
    return profileWorkflow.slice(start, end < 0 ? undefined : end);
  };
  const rnCache = getStep('Cache React Native artifact archives');
  const releaseCache = getStep('Cache Release Detox DerivedData');
  const debugCache = getStep('Cache OpenAI Debug Detox DerivedData');
  const buildStep = getStep('Build Detox iOS Simulator app');
  const fingerprintStep = getStep('Compute stable Detox cache fingerprints');
  const fingerprintStepIndex = profileWorkflow.indexOf(
    '- name: Compute stable Detox cache fingerprints',
  );
  const rnCacheStepIndex = profileWorkflow.indexOf('- name: Cache React Native artifact archives');
  const buildStepIndex = profileWorkflow.indexOf('- name: Build Detox iOS Simulator app');

  assert.ok(
    fingerprintStep.length > 0 &&
      fingerprintStep.includes('run: node scripts/ci/detox-cache-fingerprint.mjs') &&
      fingerprintStepIndex >= 0 &&
      fingerprintStepIndex < rnCacheStepIndex &&
      fingerprintStepIndex < buildStepIndex,
  );

  assert.match(rnCache, /uses: actions\/cache@[0-9a-f]{40}/);
  assert.match(rnCache, /path: ~\/Library\/Caches\/ReactNative/);
  assert.match(rnCache, /runner\.os/);
  assert.match(rnCache, /runner\.arch/);
  assert.match(rnCache, /EXPECTED_XCODE_VERSION/);
  assert.match(rnCache, /EXPECTED_IOS_SIMULATOR_SDK/);
  assert.match(rnCache, /inputs\.profile/);
  assert.match(rnCache, /steps\.detox_cache_fingerprint\.outputs\.react_native_artifacts/);
  assert.doesNotMatch(rnCache, /hashFiles\(/);

  for (const cache of [releaseCache, debugCache]) {
    assert.match(cache, /uses: actions\/cache@[0-9a-f]{40}/);
    assert.match(cache, /runner\.os/);
    assert.match(cache, /runner\.arch/);
    assert.match(cache, /EXPECTED_XCODE_VERSION/);
    assert.match(cache, /EXPECTED_IOS_SIMULATOR_SDK/);
    assert.match(cache, /steps\.detox_cache_fingerprint\.outputs\.build_inputs/);
    assert.doesNotMatch(cache, /hashFiles\(|apps\/mobile\/\*\*\/\*|packages\/\*\*\/\*/);
    assert.doesNotMatch(cache, /CoreSimulator|Keychains|simulator\.udid/);
  }
  assert.match(fingerprintSource, /pnpm-lock\.yaml/);
  assert.match(fingerprintSource, /apps\/mobile\/ios\/Podfile\.lock/);
  assert.match(fingerprintSource, /apps\/mobile/);
  assert.match(fingerprintSource, /packages/);
  assert.match(fingerprintSource, /node_modules/);
  assert.match(fingerprintSource, /iosBuildDirectory\.toLowerCase\(\)/);
  assert.match(fingerprintSource, /build\(\?:-\|\$\)/);

  assert.match(releaseCache, /if: \$\{\{ inputs\.profile == 'release' \}\}/);
  assert.match(releaseCache, /path: apps\/mobile\/ios\/build\n/);
  assert.match(releaseCache, /-release-/);
  assert.match(debugCache, /if: \$\{\{ inputs\.profile == 'openai-provider' \}\}/);
  assert.match(debugCache, /path: apps\/mobile\/ios\/build-openai-provider\n/);
  assert.match(debugCache, /-openai-provider-/);
  assert.doesNotMatch(buildStep, /if:/);
});
