import assert from 'node:assert/strict';
import test from 'node:test';
import { verifySpeechObservations } from '../speech-test-evidence.mjs';

const fixture = {
  cases: [
    {
      id: 'medication-name',
      expectedText: '메트포르민',
      medicationName: '메트포르민',
      audio: { sha256: 'expected-hash' },
    },
  ],
};
const observation = {
  id: 'medication-name',
  expectedText: '메트포르민',
  inputSha256: 'expected-hash',
  nativeResult: true,
  syntheticAudio: true,
  recognizedText: '매트 푸르 인',
  engine: 'dictation_transcriber',
};
test('retains recognition errors as measured accuracy instead of substituting fixture text', () => {
  const [result] = verifySpeechObservations([observation], fixture);
  assert.equal(result.recognizedText, observation.recognizedText);
  assert.ok(result.accuracy.characterErrorRate > 0);
  assert.equal(result.accuracy.medicationNameMatched, false);
});
test('rejects missing and repeated native fixture observations', () => {
  assert.throws(() => verifySpeechObservations([], fixture));
  assert.throws(() => verifySpeechObservations([observation, observation], fixture));
});
test('rejects substituted input hashes and missing native provenance', () => {
  for (const change of [
    { inputSha256: 'another-input' },
    { nativeResult: false },
    { syntheticAudio: false },
    { engine: 'mock' },
    { recognizedText: '' },
  ])
    assert.throws(() => verifySpeechObservations([{ ...observation, ...change }], fixture));
});
