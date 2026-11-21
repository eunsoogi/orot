import { createVoiceStopReceipts } from '../voiceStopReceipts';
import { createVoiceEndReceipt } from '../voiceEndReceipt';

test('native interruption can precede JS stop and preserves the original conversation after the screen unmounts', async () => {
  const receipts = createVoiceStopReceipts();
  const keepOld = jest.fn(async () => {});
  const owner = createVoiceEndReceipt({
    callId: 'realtime-1-1',
    isCurrent: () => true,
    retain: keepOld,
  });
  // Native primary path already took the actual stop timestamp. JS only asks for its terminal result.
  const event = { callId: 'realtime-1-1', durationSeconds: 62 };
  await receipts.stop('realtime-1-1', async () => event, owner.accept);
  await receipts.stop('realtime-1-1', async () => event, owner.accept);
  expect(keepOld).toHaveBeenCalledTimes(1);
  expect(keepOld).toHaveBeenCalledWith({ durationSeconds: 62 });
});

test.each([true, false])(
  'a newer open retries failed cleanup solely for the old protection witness: valid=%s',
  async current => {
    const receipts = createVoiceStopReceipts();
    let oldLease = 1;
    const keepOld = jest.fn(async () => {});
    const keepNew = jest.fn(async () => {});
    const original = createVoiceEndReceipt({
      callId: 'realtime-1-1',
      isCurrent: () => oldLease === 1,
      retain: keepOld,
    });
    const replacement = createVoiceEndReceipt({
      callId: 'realtime-2-2',
      isCurrent: () => true,
      retain: keepNew,
    });
    await expect(
      receipts.stop(
        'realtime-1-1',
        async () => {
          throw new Error('synthetic native release failed');
        },
        original.accept,
      ),
    ).rejects.toThrow('synthetic native release failed');
    expect([...receipts.pendingIds()]).toEqual(['realtime-1-1']);
    oldLease = current ? 1 : 2;
    for (const id of receipts.pendingIds())
      await receipts.stop(id, async () => ({
        callId: id,
        durationSeconds: 62,
      }));
    expect(keepOld).toHaveBeenCalledTimes(current ? 1 : 0);
    expect(keepNew).not.toHaveBeenCalled();
    await receipts.stop(
      'realtime-2-2',
      async () => ({ callId: 'realtime-2-2', durationSeconds: 12 }),
      replacement.accept,
    );
    expect(keepNew).toHaveBeenCalledTimes(1);
    expect(keepNew).toHaveBeenCalledWith({ durationSeconds: 12 });
    expect([...receipts.pendingIds()]).toEqual([]);
  },
);

test('duplicate stop commands cannot let a fast empty reply discard the original terminal receipt', async () => {
  const receipts = createVoiceStopReceipts();
  const retain = jest.fn(async () => {});
  const owner = createVoiceEndReceipt({
    callId: 'realtime-1-1',
    isCurrent: () => true,
    retain,
  });
  let resolve!: (event: unknown) => void;
  const held = new Promise<unknown>(finish => {
    resolve = finish;
  });
  const old = receipts.stop('realtime-1-1', () => held, owner.accept);
  await receipts.stop('realtime-1-1', async () => null);
  expect(retain).not.toHaveBeenCalled();
  resolve({ callId: 'realtime-1-1', durationSeconds: 19 });
  await old;
  expect(retain).toHaveBeenCalledTimes(1);
});
