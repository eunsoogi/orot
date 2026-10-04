import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const requireFromRepository = createRequire(join(repositoryRoot, 'package.json'));
const selectEntryRoute = requireFromRepository('./apps/mobile/e2e/selectEntryRoute.js').selectEntryRoute;
const mobileConfig = requireFromRepository('./apps/mobile/.detoxrc.js');
const releaseJestConfig = requireFromRepository('./apps/mobile/e2e/release-e2e.jest.config.js');
const openAiJestConfig = requireFromRepository('./apps/mobile/e2e/openai-provider.jest.config.js');
const openAiDetoxConfig = requireFromRepository('./apps/mobile/e2e/openai-provider.detox.config.js');
const releaseSuiteFiles = requireFromRepository('./apps/mobile/e2e/release-e2e-suite-files.js');

test('routes the existing launch arguments to one Release entry and rejects unknown selectors', () => {
  assert.equal(selectEntryRoute({}), 'storage');
  assert.equal(selectEntryRoute({ OROT_STORAGE_PROBE: 'legacy' }), 'storage');
  assert.equal(selectEntryRoute({ OROT_AGENT_MEMORY_PROBE: 'fresh' }), 'agent-memory');
  assert.equal(selectEntryRoute({ OROT_E2E_PROBE: 'graph' }), 'graph');
  assert.equal(selectEntryRoute({ OROT_E2E_PROBE: 'checkpoint' }), 'checkpoint');
  assert.equal(selectEntryRoute({ OROT_E2E_PROBE: 'appointments' }), 'appointments');
  assert.throws(() => selectEntryRoute({ OROT_E2E_PROBE: 'typo' }), /Unsupported OROT_E2E_PROBE/);
  assert.throws(
    () => selectEntryRoute({ OROT_E2E_PROBE: 'graph', OROT_AGENT_MEMORY_PROBE: 'fresh' }),
    /Conflicting Orot E2E probe selectors/,
  );
  assert.throws(
    () => selectEntryRoute({ OROT_AGENT_MEMORY_PROBE: 'fresh', OROT_STORAGE_PROBE: 'fresh' }),
    /Conflicting Orot E2E probe selectors/,
  );
  assert.throws(
    () => selectEntryRoute({ OROT_E2E_PROBE: 'checkpoint', OROT_STORAGE_PROBE: 'fresh' }),
    /Conflicting Orot E2E probe selectors/,
  );
  assert.throws(
    () => selectEntryRoute({ OROT_E2E_PROBE: 'appointments', OROT_STORAGE_PROBE: 'fresh' }),
    /Conflicting Orot E2E probe selectors/,
  );
});

test('selects the E2E-only appointments screen backed by encrypted local storage', () => {
  const router = readFileSync(join(repositoryRoot, 'apps/mobile/e2e/e2eRouterEntry.tsx'), 'utf8');
  const appointmentsEntry = readFileSync(join(repositoryRoot, 'apps/mobile/e2e/appointmentsProbeEntry.tsx'), 'utf8');
  const appointmentsTest = readFileSync(join(repositoryRoot, 'apps/mobile/e2e/appointments.test.js'), 'utf8');

  assert.match(router, /case 'appointments':\s*require\('\.\/appointmentsProbeEntry'\)/);
  assert.match(appointmentsEntry, /AppointmentsScreen/);
  assert.match(appointmentsEntry, /openLocalAppointmentRepository/);
  assert.equal((appointmentsTest.match(/OROT_E2E_PROBE: 'appointments'/g) ?? []).length, 3);
  assert.doesNotMatch(appointmentsTest, /welcome-title/);
  assert.match(appointmentsTest, /appointments-title/);
  assert.match(appointmentsTest, /appointment-add/);
  assert.match(appointmentsTest, /appointments-empty/);
  assert.doesNotMatch(appointmentsTest, /appointments-probe-ready/);
});

test('the shared Release app config bundles the router and explicitly selects every existing Release suite', () => {
  const buildCommand = mobileConfig.apps['ios.release'].build;
  assert.match(buildCommand, /ENTRY_FILE=e2e\/e2eRouterEntry\.tsx/);
  assert.equal(mobileConfig.testRunner.args.config, 'e2e/release-e2e.jest.config.js');
  assert.equal(mobileConfig.behavior.init.reinstallApp, true);
  assert.deepEqual(releaseJestConfig.testMatch, ['<rootDir>/e2e/release-e2e.test.js']);
  assert.deepEqual(releaseSuiteFiles, [
    './smoke.test.js',
    './appointments.test.js',
    './agentMemory.test.js',
    './graph.test.js',
    './checkpoint.detox.e2e.js',
    './storage.test.js',
  ]);
  assert.deepEqual(openAiJestConfig.testMatch, ['<rootDir>/e2e/openai-provider.e2e.js']);
  assert.deepEqual(releaseJestConfig.testPathIgnorePatterns, []);
  assert.equal(releaseJestConfig.rootDir, '..');
  assert.equal(openAiDetoxConfig.behavior.init.reinstallApp, true);
});

test('Release probes share one app build while OpenAI keeps its separate Debug-only fixture build', () => {
  const buildCommands = [
    mobileConfig.apps['ios.release'].build,
    openAiDetoxConfig.apps['ios.openai-provider'].build,
  ];

  for (const buildCommand of buildCommands) {
    assert.match(buildCommand, /-destination 'generic\/platform=iOS Simulator'/);
    assert.doesNotMatch(buildCommand, /\s-arch(?:\s|=)/);
    assert.match(buildCommand, /ARCHS="\$\(uname -m\)"/);
    assert.match(buildCommand, /ONLY_ACTIVE_ARCH=YES/);
    assert.match(buildCommand, /-showBuildTimingSummary/);
  }
  assert.match(buildCommands[0], /-configuration Release/);
  assert.match(buildCommands[0], /ENTRY_FILE=e2e\/e2eRouterEntry\.tsx/);
  assert.match(buildCommands[1], /-configuration Debug/);
  assert.match(buildCommands[1], /ENTRY_FILE=e2e\/openaiProviderProbeEntry\.tsx/);
});

test('runs Release and OpenAI Debug in independent jobs behind a fail-closed aggregate check', () => {
  const workflow = readFileSync(join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8');
  const profileWorkflow = readFileSync(join(repositoryRoot, '.github/workflows/detox-e2e-profile.yml'), 'utf8');
  const releaseCall = workflow.slice(workflow.indexOf('  detox_release_e2e:'), workflow.indexOf('  detox_openai_provider_e2e:'));
  const debugCall = workflow.slice(workflow.indexOf('  detox_openai_provider_e2e:'), workflow.indexOf('  detox_ios_e2e:'));
  const aggregate = workflow.slice(workflow.indexOf('  detox_ios_e2e:'));
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
  const profileWorkflow = readFileSync(join(repositoryRoot, '.github/workflows/detox-e2e-profile.yml'), 'utf8');
  const fingerprintSource = readFileSync(join(repositoryRoot, 'scripts/ci/detox-cache-fingerprint.mjs'), 'utf8');
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
  const fingerprintStepIndex = profileWorkflow.indexOf('- name: Compute stable Detox cache fingerprints');
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

test('builds the app before preparing its dedicated Simulator and waits for boot before E2E', () => {
  const profileWorkflow = readFileSync(join(repositoryRoot, '.github/workflows/detox-e2e-profile.yml'), 'utf8');
  const buildStep = profileWorkflow.indexOf('- name: Build Detox iOS Simulator app');
  const utilitiesStep = profileWorkflow.indexOf('- name: Install Detox Simulator utilities');
  const prepareStep = profileWorkflow.indexOf('- name: Prepare dedicated Detox Simulator');
  const bootWaitStep = profileWorkflow.indexOf('- name: Wait for dedicated Detox Simulator');
  const testStep = profileWorkflow.indexOf('- name: Run Detox iOS Simulator tests');

  assert.ok(
    buildStep >= 0 &&
      utilitiesStep > buildStep &&
      prepareStep > utilitiesStep &&
      bootWaitStep > prepareStep &&
      testStep > bootWaitStep,
  );
});
