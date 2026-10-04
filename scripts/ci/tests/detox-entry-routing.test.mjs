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

test('installs Detox Simulator utilities before each independent Simulator is prepared', () => {
  const profileWorkflow = readFileSync(join(repositoryRoot, '.github/workflows/detox-e2e-profile.yml'), 'utf8');
  const buildStep = profileWorkflow.indexOf('- name: Build Detox iOS Simulator app');
  const utilitiesStep = profileWorkflow.indexOf('- name: Install Detox Simulator utilities');
  const prepareStep = profileWorkflow.indexOf('- name: Prepare dedicated Detox Simulator');
  const bootWaitStep = profileWorkflow.indexOf('- name: Wait for dedicated Detox Simulator');

  assert.ok(buildStep >= 0 && utilitiesStep > buildStep && prepareStep > utilitiesStep && bootWaitStep > prepareStep);
});
