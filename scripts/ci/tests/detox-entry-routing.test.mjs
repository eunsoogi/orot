import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const requireFromRepository = createRequire(join(repositoryRoot, 'package.json'));
const selectEntryRoute = requireFromRepository(
  './apps/mobile/e2e/selectEntryRoute.js',
).selectEntryRoute;
const mobileConfig = requireFromRepository('./apps/mobile/.detoxrc.js');
const releaseJestConfig = requireFromRepository('./apps/mobile/e2e/release-e2e.jest.config.js');
const openAiJestConfig = requireFromRepository('./apps/mobile/e2e/openai-provider.jest.config.js');
const openAiDetoxConfig = requireFromRepository(
  './apps/mobile/e2e/openai-provider.detox.config.js',
);
const releaseSuiteFiles = requireFromRepository('./apps/mobile/e2e/release-e2e-suite-files.js');

function requireWithDetoxProfile(modulePath, profile) {
  const previousProfile = process.env.OROT_DETOX_TEST_PROFILE;
  const resolvedPath = requireFromRepository.resolve(modulePath);
  process.env.OROT_DETOX_TEST_PROFILE = profile;
  delete requireFromRepository.cache[resolvedPath];
  try {
    return requireFromRepository(modulePath);
  } finally {
    delete requireFromRepository.cache[resolvedPath];
    if (previousProfile === undefined) delete process.env.OROT_DETOX_TEST_PROFILE;
    else process.env.OROT_DETOX_TEST_PROFILE = previousProfile;
  }
}

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
  const appointmentsEntry = readFileSync(
    join(repositoryRoot, 'apps/mobile/e2e/appointmentsProbeEntry.tsx'),
    'utf8',
  );
  const appointmentsTest = readFileSync(
    join(repositoryRoot, 'apps/mobile/e2e/appointments.test.js'),
    'utf8',
  );

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

test('keeps the Release smoke on Calendar linking while manual CRUD stays in its probe', () => {
  const smokeTest = readFileSync(join(repositoryRoot, 'apps/mobile/e2e/smoke.test.js'), 'utf8');

  assert.match(smokeTest, /by\.id\('welcome-title'\)/);
  assert.match(smokeTest, /by\.id\('open-appointments'\)/);
  assert.match(smokeTest, /by\.id\('calendar-title'\)/);
  assert.match(smokeTest, /by\.id\('calendar-connect'\)/);
  assert.doesNotMatch(smokeTest, /by\.id\('appointment-add'\)/);
});

test('the shared Release app config bundles the router and explicitly selects every existing Release suite', () => {
  const buildCommand = mobileConfig.apps['ios.release'].build;
  const storageTest = readFileSync(join(repositoryRoot, 'apps/mobile/e2e/storage.test.js'), 'utf8');
  assert.match(buildCommand, /ENTRY_FILE=e2e\/e2eRouterEntry\.tsx/);
  assert.equal(mobileConfig.testRunner.args.config, 'e2e/release-e2e.jest.config.js');
  assert.equal(mobileConfig.behavior.init.reinstallApp, true);
  assert.equal(releaseJestConfig.bail, 1);
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
  assert.equal((storageTest.match(/await installFreshApp\(\);/g) ?? []).length, 3);
  assert.match(storageTest, /await launchProbe\('restart', true\);/);
  assert.match(
    storageTest,
    /async function installFreshApp\(\)[\s\S]*?await device\.uninstallApp\(\);[\s\S]*?await device\.clearKeychain\(\);[\s\S]*?await device\.installApp\(\);/,
  );
});

test('the Detox runner profile keeps the existing test inventories while limiting Jest to CommonJS E2E files', () => {
  const jestConfigPath = './scripts/ci/detox-e2e-profile.jest.config.cjs';
  const detoxConfigPath = './scripts/ci/detox-e2e-profile.detox.config.cjs';
  const mobileRoot = join(repositoryRoot, 'apps/mobile');
  const expectedRoots = [join(mobileRoot, 'e2e')];

  for (const [profile, baseConfig] of [
    ['release', releaseJestConfig],
    ['openai-provider', openAiJestConfig],
  ]) {
    const candidate = requireWithDetoxProfile(jestConfigPath, profile);
    assert.equal(candidate.rootDir, mobileRoot);
    assert.deepEqual(candidate.roots, expectedRoots);
    assert.deepEqual(candidate.testMatch, baseConfig.testMatch);
    assert.deepEqual(candidate.testPathIgnorePatterns, baseConfig.testPathIgnorePatterns);
    assert.deepEqual(candidate.transform, {});
    for (const preservedKey of [
      'globalSetup',
      'globalTeardown',
      'reporters',
      'testEnvironment',
      'testTimeout',
      'maxWorkers',
      'bail',
    ]) {
      assert.deepEqual(candidate[preservedKey], baseConfig[preservedKey]);
    }
  }

  for (const [profile, baseConfig] of [
    ['release', mobileConfig],
    ['openai-provider', openAiDetoxConfig],
  ]) {
    const candidateDetoxConfig = requireWithDetoxProfile(detoxConfigPath, profile);
    assert.deepEqual(candidateDetoxConfig.apps, baseConfig.apps);
    assert.deepEqual(candidateDetoxConfig.configurations, baseConfig.configurations);
    assert.deepEqual(candidateDetoxConfig.devices, baseConfig.devices);
    assert.equal(candidateDetoxConfig.behavior, baseConfig.behavior);
    assert.deepEqual(candidateDetoxConfig.testRunner.jest, baseConfig.testRunner.jest);
    assert.equal(
      candidateDetoxConfig.testRunner.args.config,
      join(repositoryRoot, 'scripts/ci/detox-e2e-profile.jest.config.cjs'),
    );
  }
});

test('Release probes share one app build while OpenAI keeps its separate Debug-only fixture build', () => {
  const buildCommands = [
    mobileConfig.apps['ios.release'].build,
    openAiDetoxConfig.apps['ios.openai-provider'].build,
  ];

  for (const buildCommand of buildCommands) {
    assert.match(buildCommand, /-destination 'generic\/platform=iOS Simulator'/);
    assert.doesNotMatch(
      buildCommand,
      /\b(?:CODE_SIGN_ENTITLEMENTS|DEVELOPMENT_TEAM|OROT_SIMULATOR_ENTITLEMENTS)=/,
      'Detox builds must exercise project-level Simulator signing defaults',
    );
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
