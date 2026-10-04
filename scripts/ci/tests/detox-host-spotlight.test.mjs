import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const workflow = readFileSync(join(repositoryRoot, '.github/workflows/detox-e2e-profile.yml'), 'utf8');
const runner = readFileSync(join(repositoryRoot, 'scripts/ci/run-detox-spotlight-experiment.mjs'), 'utf8');
const stepName = 'Measure and disable runner Spotlight indexing';
const stepStart = workflow.indexOf(`- name: ${stepName}`);
const stepEnd = workflow.indexOf('\n      - name:', stepStart + 1);
const step = workflow.slice(stepStart, stepEnd < 0 ? undefined : stepEnd);
const assessmentStart = workflow.indexOf('- name: Assess Spotlight experiment after E2E cleanup');
const assessmentEnd = workflow.indexOf('\n      - name:', assessmentStart + 1);
const assessment = workflow.slice(assessmentStart, assessmentEnd < 0 ? undefined : assessmentEnd);

test('builds before preparing the dedicated Simulator and completes boot before E2E', () => {
  const build = workflow.indexOf('- name: Build Detox iOS Simulator app');
  const utilities = workflow.indexOf('- name: Install Detox Simulator utilities');
  const prepare = workflow.indexOf('- name: Prepare dedicated Detox Simulator');
  const spotlight = workflow.indexOf(`- name: ${stepName}`);
  const boot = workflow.indexOf('- name: Wait for dedicated Detox Simulator');
  const test = workflow.indexOf('- name: Run Detox iOS Simulator tests');

  assert.ok(build >= 0 && utilities > build && prepare > utilities && spotlight > prepare && boot > spotlight && test > boot);
});

test('runs a bounded hosted-only Spotlight experiment without skipping Detox on unavailable observations', () => {
  assert.match(workflow, /runs-on: xcode-27/);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(step, /if: \$\{\{ runner\.environment == 'github-hosted' && runner\.os == 'macOS' \}\}/);
  assert.match(step, /id: spotlight_indexing/);
  assert.match(step, /timeout-minutes: 3/);
  assert.match(step, /continue-on-error: true/);
  assert.match(step, /node scripts\/ci\/run-detox-spotlight-experiment\.mjs/);
  assert.match(step, /top -d -l 2 -s 1 -n 25 -o cpu -stats pid,command,cpu,mem/);
  assert.ok(step.indexOf('sample_cpu before') < step.indexOf('node scripts/ci/run-detox-spotlight-experiment.mjs'));
  assert.ok(step.indexOf('node scripts/ci/run-detox-spotlight-experiment.mjs') < step.indexOf('sample_cpu after'));
  assert.ok(workflow.indexOf('- name: Delete dedicated Detox Simulator') < assessmentStart);
  assert.ok(assessmentStart < workflow.indexOf('- name: Upload Detox reports, logs, screenshots, and videos'));
  assert.match(assessment, /if: \$\{\{ always\(\) \}\}/);
  assert.match(assessment, /SPOTLIGHT_STEP_OUTCOME: \$\{\{ steps\.spotlight_indexing\.outcome \}\}/);
  assert.match(assessment, /Spotlight suppression was attempted but its disabled-state readback was not verified/);
  assert.match(assessment, /no suppression effect is claimed/);
});

test('requires the exact Data path and independent mount-point evidence before Spotlight queries', () => {
  assert.match(runner, /realpathSync\(configuredPath\)/);
  assert.match(runner, /name === 'data' && paths\[name\] !== DATA_VOLUME/);
  assert.match(runner, /spawnSync\('\/bin\/df', \['-P', paths\[name\]\]/);
  assert.match(runner, /const mountPoint = mountFields\.at\(-1\)/);
  assert.match(runner, /topology\.mountPoints\.workspace/);
  assert.match(runner, /topology\.mountPoints\.simulatorData/);
});
