import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const profileWorkflow = readFileSync(
  join(repositoryRoot, '.github/workflows/detox-e2e-profile.yml'),
  'utf8',
);
const profilesWorkflow = readFileSync(
  join(repositoryRoot, '.github/workflows/detox-e2e-profiles.yml'),
  'utf8',
);
const ciWorkflow = readFileSync(join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8');
const runner = readFileSync(join(repositoryRoot, 'scripts/ci/run-detox-e2e.sh'), 'utf8');
function workflowStep(name) {
  const start = profileWorkflow.indexOf(`- name: ${name}`);
  const end = profileWorkflow.indexOf('\n      - name:', start + 1);
  return start < 0 ? '' : profileWorkflow.slice(start, end < 0 ? undefined : end);
}

test('keeps profile build, Simulator lifecycle, E2E, failure diagnostics, cleanup and upload in order', () => {
  const pods = profileWorkflow.indexOf('- name: Install Detox CocoaPods dependencies');
  const simulatorUtilities = profileWorkflow.indexOf('- name: Install Detox Simulator utilities');
  const nodeSetup = profileWorkflow.indexOf('- name: Set up Node.js');
  const toolchain = profileWorkflow.indexOf('- name: Verify runner toolchain');
  const installIndex = profileWorkflow.indexOf(
    '- name: Install dependencies and check Speech readiness',
  );
  const install = workflowStep('Install dependencies and check Speech readiness');
  const rubySetup = profileWorkflow.indexOf('- name: Set up Ruby');
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
  const bootStep = workflowStep('Wait for dedicated Detox Simulator');
  const diagnosticsStep = workflowStep('Collect simulator logs');
  const prepareStep = workflowStep('Prepare dedicated Detox Simulator');
  const teardownStep = workflowStep('Delete dedicated Detox Simulator');

  // Finish dependency materialization before boot, then overlap boot with native and cache preparation.
  assert.ok(
    nodeSetup >= 0 &&
      nodeSetup < toolchain &&
      toolchain < installIndex &&
      installIndex < prepare &&
      prepare < rubySetup &&
      rubySetup < pods &&
      pods < simulatorUtilities &&
      simulatorUtilities < build &&
      build > prepare &&
      boot > build &&
      tests > boot,
  );
  assert.match(install, /pnpm install --frozen-lockfile/);
  assert.ok(diagnostics > tests && teardown > diagnostics && upload > teardown);
  assert.match(prepareStep, /id: prepare_detox_simulator/);
  assert.match(prepareStep, /artifacts\/detox\/simulator\.udid/);
  assert.match(bootStep, /simulator-baseline\.json/);
  assert.match(
    diagnosticsStep,
    /collect-simulator-diagnostics\.sh[\s\S]*inputs\.profile[\s\S]*simulator-baseline\.json[\s\S]*simulator-targets\.txt/,
  );
  assert.match(teardownStep, /if: \$\{\{ always\(\) \}\}/);
  assert.match(
    teardownStep,
    /if \[\[ ! -s artifacts\/detox\/simulator\.udid \]\][\s\S]*?cat artifacts\/detox\/simulator\.udid[\s\S]*simulator-targets\.txt/,
  );
  assert.match(testStep, /timeout-minutes: 45/);
  assert.match(testStep, /run:.*scripts\/ci\/run-test-suite\.sh/);
  assert.match(profileWorkflow, /if: \$\{\{ always\(\) \}\}/);
  assert.doesNotMatch(profileWorkflow, /mdutil|Spotlight|spotlight/i);
  assert.doesNotMatch(ciWorkflow, /mdutil|Spotlight|spotlight/i);
});

test('keeps the directly invoked Simulator diagnostics helper executable', () => {
  // The Git executable bit is required because the workflow runs this helper without Bash.
  const diagnosticsPath = join(repositoryRoot, 'scripts/ci/collect-simulator-diagnostics.sh');
  assert.notEqual(statSync(diagnosticsPath).mode & 0o111, 0);
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
    profilesWorkflow,
    /resource_sampling:[\s\S]*?required: false[\s\S]*?type: boolean[\s\S]*?default: false/,
  );
  assert.match(profilesWorkflow, /resource_sampling: \$\{\{ inputs\.resource_sampling \}\}/);
  assert.match(
    profileWorkflow,
    /OROT_DETOX_RESOURCE_SAMPLING: \$\{\{ inputs\.resource_sampling \}\}/,
  );
  assert.match(runner, /resource_sample_limit=4/);
  assert.match(runner, /sample_index < resource_sample_limit/);
});
