import assert from 'node:assert/strict';
import test from 'node:test';
import { iosTestInventory } from '../ios-test-inventory.mjs';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';
import { iosTestImpactForPath } from '../ios-test-impact.mjs';

// These contracts are synthetic native lifecycle tests, not API or microphone acceptance.
test('Realtime lifecycle cases have exactly one core integration owner', () => {
  const cases = iosTestInventory('core').filter((id) =>
    id.includes('/RealtimeVoiceLifecycleTests/'),
  );
  assert.equal(cases.length, 6);
  const scheduled = iosTestCohortTasks('core-integration').flatMap((task) => task.identifiers);
  for (const id of cases) assert.equal(scheduled.filter((candidate) => candidate === id).length, 1);
  assert.deepEqual(
    iosTestImpactForPath('apps/mobile/ios/OrotIntegrationTests/RealtimeVoiceLifecycleTests.swift')
      .cohorts,
    ['core-integration'],
  );
});

test('Realtime production modules retain lifecycle and shared audio ownership dependents', () => {
  for (const file of [
    'RealtimeVoiceAudio.swift',
    'RealtimeVoiceSocket.swift',
    'RealtimeVoiceCall.swift',
    'VoiceRealtimeModule.swift',
    'VoiceRealtimeModule.m',
  ]) {
    const impact = iosTestImpactForPath(`apps/mobile/ios/OrotMobile/${file}`);
    assert.equal(impact.reason, 'realtime-voice-native-module');
    assert.ok(impact.cohorts.includes('core-integration'));
    assert.ok(
      impact.cohorts.some((name) => name === 'microphone' || name.startsWith('microphone-')),
    );
  }
});
