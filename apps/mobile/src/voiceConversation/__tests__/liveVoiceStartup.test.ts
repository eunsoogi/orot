import { createRealtimeSettingsPermission } from '../createRealtimeSettingsPermission';
import { createRealtimeVoiceSession } from '../realtimeVoiceSession';
import type { NativeRealtimeVoice } from '../nativeRealtimeVoice';
import {
  liveModel,
  type Preferences,
} from '../../voiceSettings/liveVoicePreferences';

const flush = async () => {
  for (let i = 0; i < 18; i++) await Promise.resolve();
};
function gate<T>() {
  let resolve!: (value: T) => void;
  const wait = new Promise<T>(send => {
    resolve = send;
  });
  return { wait, resolve };
}
function fixture() {
  let current = true;
  const authorize = jest.fn(async () => 'authorized' as const);
  const permission = createRealtimeSettingsPermission(
    {
      authorize,
      isAuthorizationCurrent: () => current,
    },
    true,
  );
  const prefs: Preferences = Object.freeze({
    schema: 1,
    language: 'ko',
    voice: 'noeul',
  });
  const configured = {
    model: liveModel,
    apiKey: 'synthetic-key',
    preferences: prefs,
  };
  const credentials = jest.fn(async () => configured);
  const native: NativeRealtimeVoice = {
    open: jest.fn(async () => {}),
    stop: jest.fn(async () => {}),
    pause: jest.fn(async () => {}),
    resume: jest.fn(async () => {}),
    interrupt: jest.fn(async () => {}),
    onState: jest.fn(() => () => {}),
    onTranscript: jest.fn(() => () => {}),
    onInterrupted: jest.fn(() => () => {}),
  };
  const session = createRealtimeVoiceSession({
    native,
    model: liveModel,
    liveAudioOnly: true,
    sessionId: 2,
    credentials,
    isCurrent: permission.current,
    changed: jest.fn(),
    transcript: jest.fn(),
  });
  return {
    native,
    session,
    permission,
    credentials,
    configured,
    authorize,
    revoke: () => {
      current = false;
    },
  };
}

it('reads neither Keychain-backed settings nor the native bridge when Live authority is stale', async () => {
  const run = fixture();
  run.revoke();
  expect(await run.permission.authorize(liveModel, jest.fn())).toBe(false);
  run.session.start();
  expect(run.credentials).not.toHaveBeenCalled();
  expect(run.native.open).not.toHaveBeenCalled();
});

it('freezes one startup choice under an exact audio-only request without enabling tools', async () => {
  const run = fixture();
  expect(await run.permission.authorize(liveModel, jest.fn())).toBe(true);
  run.session.start(true);
  await flush();
  expect(run.authorize).toHaveBeenCalledWith(
    expect.objectContaining({
      providerId: 'openai-live',
      recipient: 'OpenAI Live API',
      modelId: liveModel,
      consentScope: expect.objectContaining({ purpose: 'live_audio' }),
      allowedScope: { sourceKinds: [] },
    }),
  );
  expect(run.native.open).toHaveBeenCalledWith(
    expect.stringMatching(/^live-/),
    liveModel,
    'synthetic-key',
    '',
    false,
    { schema: 1, language: 'ko', voice: 'noeul' },
    expect.any(Function),
  );
  expect(run.credentials).toHaveBeenCalledTimes(1);
});

it('revocation during deferred credentials or native open cannot revive the old id', async () => {
  const early = fixture();
  const read = gate<typeof early.configured>();
  early.credentials.mockReturnValueOnce(read.wait);
  await early.permission.authorize(liveModel, jest.fn());
  early.session.start();
  early.revoke();
  early.session.revalidate();
  read.resolve(early.configured);
  await flush();
  expect(early.native.open).not.toHaveBeenCalled();
  expect(early.native.stop).toHaveBeenCalledTimes(1);

  const late = fixture();
  const pending = gate<void>();
  jest.mocked(late.native.open).mockReturnValueOnce(pending.wait);
  await late.permission.authorize(liveModel, jest.fn());
  late.session.start();
  await flush();
  const [id, , , , , , gateCurrent] = jest.mocked(late.native.open).mock
    .calls[0]!;
  late.revoke();
  late.session.revalidate();
  expect(gateCurrent?.()).toBe(false);
  pending.resolve();
  await flush();
  expect(late.native.open).toHaveBeenCalledTimes(1);
  expect(
    jest.mocked(late.native.stop).mock.calls.every(args => args[0] === id),
  ).toBe(true);
});
