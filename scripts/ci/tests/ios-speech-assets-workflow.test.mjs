import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { iosTestInventory } from '../ios-test-inventory.mjs';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';

test('hosted Speech verifies actual assets before its first recognition without retrying a fixture', () => {
  const tasks = iosTestCohortTasks('speech');
  assert.deepEqual(
    tasks.map(({ suite }) => suite),
    ['preparation', 'integration', 'journey'],
  );
  assert.deepEqual(tasks[0].identifiers, iosTestInventory('speech', 'preparation'));
  assert.equal(tasks[0].identifiers.length, 1);
  assert.ok(tasks[0].identifiers.every((id) => id.includes('/SpeechAssetPreparationTests/')));
  const runner = readFileSync('scripts/ci/run-ios-test-cohort.mjs', 'utf8');
  assert.match(runner, /OROT_IOS_TEST_SUITE: suite/);
  assert.match(runner, /run-ios-tests\.mjs/);
  assert.match(runner, /ios-test-results\.mjs/);
  const source = readFileSync('.github/actions/ios-test-cohort-run/action.yml', 'utf8');
  assert.ok(
    source.indexOf('Verify configuration, source and product integrity before boot') <
      source.indexOf('prepare-cohort'),
  );
  assert.match(source, /artifacts\/ios-cohort\/results/);
  assert.doesNotMatch(source, /continue-on-error|test-iterations/);
});

test('Speech preparation diagnoses each public asset boundary without changing its deadline or swallowing failure', () => {
  const source = readFileSync(
    'apps/mobile/ios/OrotIntegrationTests/SpeechAssetPreparationTests.swift',
    'utf8',
  );
  assert.equal(
    (source.match(/SpeechTranscriptionDeadline\.run\(timeoutNanoseconds: 180_000_000_000\)/g) ?? [])
      .length,
    1,
  );
  for (const stage of [
    'availability',
    'speech-supported-locale',
    'dictation-supported-locale',
    'status-before',
    'installation-request',
    'download-and-install',
    'status-after',
    'compatible-formats',
    'best-format',
  ])
    assert.ok(source.includes(`trace.measure("${stage}")`), stage);
  assert.match(source, /selected-korean-assets-preparation-failure[\s\S]*throw error/);
  assert.match(source, /XCTAssertEqual\(result\["statusAfter"\] as\? String, "installed"\)/);
  assert.match(source, /XCTAssertEqual\(result\["bestFormatAvailable"\] as\? Bool, true\)/);
  assert.match(source, /XCTAssertGreaterThan[\s\S]*compatibleFormatCount/);
  assert.match(source, /XCTAssertEqual\(result\["inputAudioUsed"\] as\? Bool, false\)/);
});

test('Speech failure snapshots read public progress without another async request or installation attempt', () => {
  const source = readFileSync(
    'apps/mobile/ios/OrotIntegrationTests/SpeechAssetPreparationTests.swift',
    'utf8',
  );
  assert.equal((source.match(/installation\.downloadAndInstall\(\)/g) ?? []).length, 1);
  const trackingStart = source.indexOf('trace.trackInstallationProgress(installation.progress)');
  assert.ok(
    trackingStart >= 0 && trackingStart < source.indexOf('installation.downloadAndInstall()'),
  );
  const snapshot = source.slice(
    source.indexOf('func snapshot()'),
    source.indexOf('private var elapsedMs'),
  );
  assert.match(snapshot, /installationProgressInitial/);
  assert.match(snapshot, /progressSnapshot\(installationProgress\)/);
  for (const key of [
    'totalUnitCount',
    'completedUnitCount',
    'fractionCompleted',
    'isIndeterminate',
    'isFinished',
    'isCancelled',
    'isPaused',
  ])
    assert.ok(snapshot.includes(`progress.${key}`), key);
  assert.doesNotMatch(
    snapshot,
    /await|downloadAndInstall|AssetInventory|localizedDescription|userInfo/,
  );
});
