import { createVoiceEndReceipt } from '../voiceEndReceipt';

test('accepts only a matching closed native envelope and persists seconds once', async () => {
  const retain = jest.fn(async () => {});
  const stamp = createVoiceEndReceipt({
    callId: 'realtime-1-1',
    isCurrent: () => true,
    retain,
  });
  for (const invalid of [
    null,
    ['realtime-1-1', 65],
    { callId: 'realtime-1-0', durationSeconds: 65 },
    { callId: 'realtime-1-1', durationSeconds: -1 },
    { callId: 'realtime-1-1', durationSeconds: 0.5 },
    { callId: 'realtime-1-1', durationSeconds: Infinity },
    { callId: 'realtime-1-1', durationSeconds: 65, text: 'fake private text' },
  ])
    expect(stamp.accept(invalid)).toBeUndefined();
  await stamp.accept({ callId: 'realtime-1-1', durationSeconds: 65 });
  await stamp.accept({ callId: 'realtime-1-1', durationSeconds: 66 });
  expect(retain).toHaveBeenCalledTimes(1);
  expect(retain).toHaveBeenCalledWith({ durationSeconds: 65 });
});

test('a superseded conversation lease cannot revive on duplicate native delivery', () => {
  let lease = 4;
  const retain = jest.fn(async () => {});
  const stamp = createVoiceEndReceipt({
    callId: 'voice-1-1-call-1',
    isCurrent: () => lease === 4,
    retain,
  });
  const event = { callId: 'voice-1-1-call-1', durationSeconds: 1 };
  lease = 5;
  expect(stamp.accept(event)).toBeUndefined();
  lease = 4;
  expect(stamp.accept(event)).toBeUndefined();
  expect(retain).not.toHaveBeenCalled();
});

test('discard defeats stale events; a genuinely connected subsecond call keeps zero seconds', async () => {
  const retain = jest.fn(async () => {});
  const params = {
    callId: 'realtime-1-1',
    isCurrent: () => true,
    retain,
  };
  const detached = createVoiceEndReceipt(params);
  detached.discard();
  const event = { callId: params.callId, durationSeconds: 0 };
  expect(detached.accept(event)).toBeUndefined();
  await createVoiceEndReceipt(params).accept(event);
  expect(retain).toHaveBeenCalledTimes(1);
  expect(retain).toHaveBeenCalledWith({ durationSeconds: 0 });
});

test('an uncertain write is never automatically replayed by another stop receipt', async () => {
  const retain = jest.fn(async () => {
    throw new Error('synthetic protected write failure');
  });
  const stamp = createVoiceEndReceipt({
    callId: 'realtime-1-1',
    isCurrent: () => true,
    retain,
  });
  const event = { callId: 'realtime-1-1', durationSeconds: 48 };
  await expect(stamp.accept(event)).rejects.toThrow(
    'synthetic protected write failure',
  );
  expect(stamp.accept(event)).toBeUndefined();
  expect(retain).toHaveBeenCalledTimes(1);
});
