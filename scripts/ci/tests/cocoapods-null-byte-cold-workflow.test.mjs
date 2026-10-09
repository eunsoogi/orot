import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const workflow = readFileSync(
  path.join(repositoryRoot, '.github/workflows/cocoapods-null-byte-diagnostic.yml'),
  'utf8',
);

function workflowStep(name) {
  const marker = '- name: ' + name;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, 'workflow step must exist: ' + name);
  const nextStep = workflow.indexOf('\n      - name:', start + marker.length);
  return workflow.slice(start, nextStep === -1 ? undefined : nextStep);
}

function workflowStepIndex(name) {
  const index = workflow.indexOf('- name: ' + name);
  assert.notEqual(index, -1, 'workflow step must exist: ' + name);
  return index;
}

// Build wrappers require source snapshots from before CocoaPods rewrites Xcode integration files.
test('keeps the diagnostic run pinned to its issue and PR branches and original toolchain', () => {
  const trigger = workflow.slice(workflow.indexOf('on:\n'), workflow.indexOf('\npermissions:'));

  assert.match(
    trigger,
    /branches:\n\s+- eunsoogi\/issue-136-null-byte-recurrence\n\s+- eunsoogi\/issue-136-realdirpath-entry-snapshot/,
  );
  assert.match(trigger, /paths:\n\s+- \.github\/workflows\/cocoapods-null-byte-diagnostic\.yml/);
  assert.doesNotMatch(workflow, /uses:\s*actions\/cache@/);
  assert.match(workflow, /runs-on: macos-26/);
  assert.match(workflow, /EXPECTED_XCODE_VERSION: '26\.2'/);
  assert.match(workflow, /EXPECTED_IOS_SIMULATOR_RUNTIME_NAME: iOS 26\.2/);
  assert.match(workflow, /EXPECTED_DETOX_SIMULATOR_DEVICE_NAME: iPhone 17 Pro/);
  assert.match(workflow, /EXPECTED_RUBY_VERSION: '4\.0\.7'/);
  assert.match(workflow, /EXPECTED_COCOAPODS_VERSION: '1\.17\.0'/);
  assert.match(workflow, /EXPECTED_APPLESIMUTILS_VERSION: '0\.9\.12'/);
});

test('prepares uncached build provenance before installing Pods and builds both required apps', () => {
  const productionSnapshot = workflowStep('Prepare production build-input snapshot');
  const transcriptionSnapshot = workflowStep('Prepare transcription build-input snapshot');

  assert.match(
    workflowStep('Compute stable Detox build fingerprints'),
    /run-command\.sh detox-build-fingerprint artifacts\/detox\/build-fingerprint\.log -- node scripts\/ci\/detox-cache-fingerprint-cli\.mjs --derived-data-only/,
  );
  assert.match(
    productionSnapshot,
    /run-command\.sh production-input-snapshot artifacts\/detox\/production-input-snapshot\.log -- node scripts\/ci\/detox-derived-data-cache\.mjs prepare production/,
  );
  assert.match(
    transcriptionSnapshot,
    /run-command\.sh transcription-input-snapshot artifacts\/detox\/transcription-input-snapshot\.log -- node scripts\/ci\/detox-derived-data-cache\.mjs prepare transcription/,
  );
  for (const step of [productionSnapshot, transcriptionSnapshot]) {
    assert.match(step, /DETOX_CACHE_RUNNER_OS:/);
    assert.match(step, /DETOX_CACHE_RUNNER_ARCH:/);
    assert.match(step, /EXPECTED_IOS_SIMULATOR_SDK:/);
  }
  assert.match(
    workflowStep('Install Detox CocoaPods dependencies'),
    /bash scripts\/ci\/install-detox-cocoapods\.sh/,
  );
  assert.match(
    workflowStep('Build iOS Simulator app'),
    /run-command\.sh ios-simulator-build artifacts\/detox\/ios-app-build\.log -- bash scripts\/ci\/build-ios-simulator-app\.sh build/,
  );
  assert.match(
    workflowStep('Build transcription Detox app'),
    /run-command\.sh detox-build artifacts\/detox\/transcription-build\.log -- bash scripts\/ci\/build-detox-apps\.sh transcription --skip-pods/,
  );
  assert.match(
    workflowStep('Run Speech readiness regression'),
    /apps\/mobile\/e2e\/transcription\/run-readiness-regression\.sh/,
  );

  const orderedSteps = [
    'Run Speech readiness regression',
    'Compute stable Detox build fingerprints',
    'Prepare production build-input snapshot',
    'Prepare transcription build-input snapshot',
    'Install Detox CocoaPods dependencies',
    'Build iOS Simulator app',
    'Build transcription Detox app',
    'Install AppleSimulatorUtils',
    'Prepare dedicated Speech Simulator',
    'Wait for dedicated Speech Simulator',
    'Run Speech transcription Detox E2E',
  ].map(workflowStepIndex);
  assert.deepEqual(
    orderedSteps,
    [...orderedSteps].sort((left, right) => left - right),
  );
  assert.match(
    workflowStep('Wait for dedicated Speech Simulator'),
    /steps\.prepare_speech_simulator\.outputs\.udid/,
  );
  assert.match(
    workflowStep('Run Speech transcription Detox E2E'),
    /scripts\/ci\/run-test-suite\.sh e2e-transcription artifacts\/detox/,
  );
});

test('always collects Simulator diagnostics, deletes the dedicated device, and uploads logs', () => {
  assert.match(workflowStep('Collect Simulator diagnostics'), /if: \$\{\{ always\(\) \}\}/);
  const teardown = workflowStep('Delete dedicated Speech Simulator');
  assert.match(teardown, /if: \$\{\{ always\(\) \}\}/);
  assert.match(teardown, /simulator\.udid/);
  assert.match(teardown, /No dedicated Simulator ID was recorded/);
  assert.match(teardown, /teardown-detox-simulator\.sh/);

  const upload = workflowStep('Upload cold install, build, and Speech E2E evidence');
  assert.match(upload, /if: \$\{\{ always\(\) \}\}/);
  assert.match(upload, /artifacts\/detox\//);
  assert.match(upload, /retention-days: 14/);
  const cleanupOrder = [
    'Collect Simulator diagnostics',
    'Delete dedicated Speech Simulator',
    'Upload cold install, build, and Speech E2E evidence',
  ].map(workflowStepIndex);
  assert.deepEqual(
    cleanupOrder,
    [...cleanupOrder].sort((left, right) => left - right),
  );
});
