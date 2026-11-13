import {
  initialVoiceState,
  transitionVoiceTurn,
  type VoiceEvent,
  type VoiceState,
} from '../voiceTurn';

const identity = { sessionId: 1, providerId: 'selected', turnId: 'turn-a' };
const authorized: VoiceEvent = {
  type: 'authorized',
  identity,
  microphone: true,
  speech: true,
  onDevice: true,
  consentProviderId: 'selected',
};
const transcript: VoiceEvent = {
  type: 'transcript',
  identity,
  text: 'hello',
  currentProviderId: 'selected',
  consentProviderId: 'selected',
  photoPending: false,
};
const start = () =>
  transitionVoiceTurn(initialVoiceState, { type: 'start', identity }).state;
const listening = () => transitionVoiceTurn(start(), authorized).state;
const processing = () => transitionVoiceTurn(listening(), transcript).state;

test('snapshots caller-owned identity for the entire turn', () => {
  const mutable = { ...identity };
  const started = transitionVoiceTurn(initialVoiceState, {
    type: 'start',
    identity: mutable,
  });
  mutable.sessionId = 99;
  mutable.providerId = 'other';
  expect(started.state.identity).toEqual(identity);
  expect(transitionVoiceTurn(started.state, authorized).state.phase).toBe(
    'listening',
  );
  expect(
    transitionVoiceTurn(started.state, { ...authorized, identity: mutable })
      .state,
  ).toBe(started.state);
});

test('requires explicit activation, permissions, on-device recognition and selected provider consent', () => {
  expect(transitionVoiceTurn(initialVoiceState, authorized).effects).toEqual(
    [],
  );
  for (const denied of [
    { microphone: false },
    { speech: false },
    { onDevice: false },
    { consentProviderId: null },
  ]) {
    const result = transitionVoiceTurn(start(), { ...authorized, ...denied });
    expect(result.state.phase).toBe('cleaning');
    expect(result.effects[0].type).toBe('cleanup');
  }
});

test('submits one turn and rejects changed consent, provider, or staged photo', () => {
  const result = transitionVoiceTurn(listening(), transcript);
  expect(result.effects).toEqual([
    { type: 'submit', identity, transcript: 'hello' },
  ]);
  expect(transitionVoiceTurn(result.state, transcript).effects).toEqual([]);
  for (const change of [
    { currentProviderId: 'other' },
    { consentProviderId: null },
    { photoPending: true },
  ]) {
    expect(
      transitionVoiceTurn(listening(), { ...transcript, ...change }).state
        .phase,
    ).toBe('cleaning');
  }
});

test('stops each phase, fences late callbacks and cancels only the owned processing request', () => {
  const speaking = transitionVoiceTurn(processing(), {
    type: 'answer',
    identity,
    text: 'answer',
  }).state;
  for (const state of [start(), listening(), processing(), speaking]) {
    const stopped = transitionVoiceTurn(state, { type: 'stop', identity });
    expect(stopped.effects).toEqual([
      {
        type: 'cleanup',
        identity,
        cancelRequest: state.phase === 'processing',
      },
    ]);
    expect(
      transitionVoiceTurn(stopped.state, {
        type: 'answer',
        identity,
        text: 'late',
      }).effects,
    ).toEqual([]);
    expect(
      transitionVoiceTurn(state, {
        type: 'stop',
        identity: { ...identity, sessionId: 2 },
      }).state,
    ).toBe(state);
  }
});

test('does not restart while cleanup is pending or failed', () => {
  const cleaning = transitionVoiceTurn(listening(), {
    type: 'end',
    identity,
  }).state;
  const retry = {
    type: 'start',
    identity: { ...identity, turnId: 'turn-b' },
  } as const;
  expect(transitionVoiceTurn(cleaning, retry).state).toBe(cleaning);
  const failed = transitionVoiceTurn(cleaning, {
    type: 'cleanupFailed',
    identity,
  }).state;
  expect(transitionVoiceTurn(failed, retry).state).toBe(failed);
  const ended: VoiceState = transitionVoiceTurn(cleaning, {
    type: 'cleaned',
    identity,
  }).state;
  expect(transitionVoiceTurn(ended, retry).state.phase).toBe('authorizing');
});
