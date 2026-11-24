import type { SettingsVoicePairSelection } from '../../storage/settingsVoicePairSelection';
import {
  matchVoicePairDeviceCandidate,
  stageVoicePairDeviceCandidate,
} from '../voicePairDeviceCandidate';

const pair = (
  voice = 'b',
  tools = 'c',
  owner = 'a',
): SettingsVoicePairSelection => ({
  version: 1,
  speechModel: 'gpt-live-1.1',
  backendModel: 'gpt-6-luna',
  credentialEpoch: owner.repeat(64),
  voiceGeneration: voice.repeat(64),
  responsesGeneration: tools.repeat(64),
});

const candidate = (value = pair()) => ({
  pair: value,
  preferences: { schema: 1, language: 'ko', voice: 'noeul' } as const,
});
test('staging retains the previously committed pair and never activates a new pair alone', () => {
  const old = candidate();
  const next = candidate(pair('d', 'e'));
  const staged = stageVoicePairDeviceCandidate(
    [old],
    old.pair,
    next,
    old.pair.credentialEpoch,
  );
  expect(
    matchVoicePairDeviceCandidate(staged, old.pair, old.pair.credentialEpoch),
  ).toEqual(old);
  expect(
    matchVoicePairDeviceCandidate(staged, next.pair, old.pair.credentialEpoch),
  ).toEqual(next);
  expect(
    matchVoicePairDeviceCandidate(staged, null, old.pair.credentialEpoch),
  ).toBeNull();
});

test('refuses wrong account or missing exact committed witness; no audio-only fallback', () => {
  expect(() =>
    matchVoicePairDeviceCandidate([candidate()], pair(), 'f'.repeat(64)),
  ).toThrow();
  expect(() =>
    matchVoicePairDeviceCandidate(
      [candidate()],
      pair('d', 'e'),
      'a'.repeat(64),
    ),
  ).toThrow();
  expect(() =>
    matchVoicePairDeviceCandidate(
      [candidate(), candidate()],
      pair(),
      'a'.repeat(64),
    ),
  ).toThrow();
});
