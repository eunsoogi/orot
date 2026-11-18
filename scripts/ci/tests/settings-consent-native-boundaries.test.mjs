import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read = (file) => readFileSync(`apps/mobile/${file}`, 'utf8');

test('synthetic Realtime bridge is compiler gated and cannot select live transport for malformed opt-in', () => {
  const fixture = read('ios/OrotMobile/SettingsConsentRealtimeFixture.swift');
  assert.match(fixture, /^#if OROT_TESTS && targetEnvironment\(simulator\)/);
  for (const boundary of [
    '-OROT_TEST_HOST',
    'settings-provider-layout',
    'OROT_SETTINGS_CONSENT_BOUNDARIES',
    'test-settings-consent-',
    'UUID(uuidString:',
  ])
    assert.ok(fixture.includes(boundary), boundary);
  assert.ok(!fixture.includes('URLSession'));
  assert.ok(!fixture.includes('AVAudioEngine'));
  assert.ok(fixture.includes('permission: { $0(admitted) }'));
  const module = read('ios/OrotMobile/VoiceRealtimeModule.swift');
  assert.ok(
    module.indexOf('if SettingsConsentRealtimeFixture.requested') <
      module.indexOf('return RealtimeVoiceCall(systemCall:'),
  );
  assert.match(
    module,
    /#if OROT_TESTS && targetEnvironment\(simulator\)[\s\S]*settingsConsentSnapshot/,
  );
  const bridge = read('ios/OrotMobile/VoiceRealtimeModule.m');
  assert.match(
    bridge,
    /#if defined\(OROT_TESTS\) && TARGET_OS_SIMULATOR\s+RCT_EXTERN_METHOD\(settingsConsentSnapshot/,
  );
});

test('registered journey retains original assertions and adds independent credential and bridge receipts', () => {
  const source = read('ios/OrotUITests/SettingsConsentUITests.swift');
  for (const value of [
    '선택한 ChatGPT 계정',
    'OpenAI API',
    'OpenAI Realtime API',
    'verifyNativeBoundaries(app)',
    'settings-boundary-replace',
    'settings-boundary-remove',
    'settings-boundary-open',
    'settings-boundary-revoke',
    'audioStops',
    'readyEvents',
    'audioStarts',
    'in-memory',
  ])
    assert.ok(source.includes(value), value);
  assert.equal(
    (source.match(/func testExplicitThreeTabGrantsAndRevocationSurviveProcessRestart\(/g) ?? [])
      .length,
    1,
  );
  const entry = read('e2e/SettingsConsentBoundaryEntry.tsx');
  assert.ok(
    entry.indexOf('consentFixtureIdentity(') <
      entry.indexOf('await openSettingsCredentialNativeFixture('),
  );
  assert.ok(entry.includes('createRealtimeSettingsPermission(owner.authorization())'));
  assert.ok(entry.includes('await stopping.current'));
  assert.ok(entry.includes('settingsConsentSnapshot(true)'));
});
