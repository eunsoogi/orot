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

function workflowStep(name) {
  const start = profileWorkflow.indexOf(`- name: ${name}`);
  const end = profileWorkflow.indexOf('\n      - name:', start + 1);
  return profileWorkflow.slice(start, end < 0 ? undefined : end);
}

test('pins only transcription to iOS 26.2 and partitions its native caches', () => {
  const podsCache = workflowStep('Cache Detox CocoaPods intermediates');
  const appCache = workflowStep('Cache Detox profile app product');
  const cacheRecord = workflowStep('Record Detox cache state');
  const simulatorPreparation = workflowStep('Prepare dedicated Detox Simulator');

  assert.match(
    profileWorkflow,
    /runs-on: \$\{\{ inputs\.profile == 'transcription' && 'macos-26' \|\| 'xcode-27' \}\}/,
  );
  assert.match(
    profileWorkflow,
    /DEVELOPER_DIR: \$\{\{ inputs\.profile == 'transcription' && '\/Applications\/Xcode_26\.2\.app\/Contents\/Developer' \|\| '\/Applications\/Xcode\.app\/Contents\/Developer' \}\}/,
  );
  assert.match(
    profileWorkflow,
    /EXPECTED_MACOS_VERSION: \$\{\{ inputs\.profile == 'transcription' && '26\.6\.1' \|\| '27\.0' \}\}/,
  );
  assert.match(
    profileWorkflow,
    /EXPECTED_IOS_SIMULATOR_RUNTIME_NAME: \$\{\{ inputs\.profile == 'transcription' && 'iOS 26\.2' \|\| 'iOS 27\.0' \}\}/,
  );
  assert.match(
    profileWorkflow,
    /EXPECTED_IOS_SIMULATOR_RUNTIME_IDENTIFIER: \$\{\{ inputs\.profile == 'transcription' && 'com\.apple\.CoreSimulator\.SimRuntime\.iOS-26-2' \|\| 'com\.apple\.CoreSimulator\.SimRuntime\.iOS-27-0' \}\}/,
  );
  assert.match(
    profileWorkflow,
    /EXPECTED_DETOX_SIMULATOR_DEVICE_NAME: \$\{\{ inputs\.profile == 'transcription' && 'iPhone 17 Pro' \|\| 'iPhone 18 Pro' \}\}/,
  );
  assert.match(
    profileWorkflow,
    /EXPECTED_DETOX_SIMULATOR_DEVICE_TYPE_ID: \$\{\{ inputs\.profile == 'transcription' && 'com\.apple\.CoreSimulator\.SimDeviceType\.iPhone-17-Pro' \|\| 'com\.apple\.CoreSimulator\.SimDeviceType\.iPhone-18-Pro' \}\}/,
  );
  assert.match(profileWorkflow, /DETOX_CACHE_RUNTIME_SUFFIX/);
  assert.match(podsCache, /DETOX_CACHE_RUNTIME_SUFFIX/);
  assert.match(
    appCache,
    /inputs\.profile\s*\}\}\$\{\{\s*env\.DETOX_CACHE_RUNTIME_SUFFIX\s*\}\}-native-/,
  );
  assert.match(cacheRecord, /ios_simulator_runtime=/);
  assert.match(cacheRecord, /ios_simulator_device_type=/);
  assert.match(simulatorPreparation, /prepare-detox-simulator\.sh[\s\S]*?inputs\.profile/);
});
