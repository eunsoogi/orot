import { createLiveResponsesHealthToolExecutor } from '../liveResponsesHealthToolExecutor';
import { call, fixture } from '../testSupport/liveResponsesProtectedFixture';

test('one fresh settings receipt before local approval; later owner and source checks stay independent', async () => {
  const f = await fixture();
  const resolveOwner = jest.fn(f.input.resolveOwner);
  const protectedDataAvailable = jest.fn(f.input.protectedDataAvailable);
  let receiptReadsAtPrompt = 0;
  let checksAtPrompt = 0;
  try {
    await createLiveResponsesHealthToolExecutor({
      ...f.input,
      resolveOwner,
      protectedDataAvailable,
      confirm: async () => {
        receiptReadsAtPrompt = resolveOwner.mock.calls.length;
        checksAtPrompt = protectedDataAvailable.mock.calls.length;
        expect(f.read).not.toHaveBeenCalled();
        return true;
      },
    })(call, f.controller.signal);
    expect(receiptReadsAtPrompt).toBe(1);
    expect(checksAtPrompt).toBe(1);
    expect(resolveOwner).toHaveBeenCalledTimes(4);
    expect(protectedDataAvailable).toHaveBeenCalledTimes(4);
    expect(f.settle).toHaveBeenCalledTimes(1);
    expect(f.settle.mock.calls[0]?.[2]).not.toBeNull();
  } finally {
    f.close();
  }
});

test.each(['locked', 'rotated'] as const)(
  'held first owner lookup revoked by %s cannot open approval or read health data',
  async scenario => {
    const f = await fixture();
    const confirm = jest.fn(f.input.confirm);
    try {
      await createLiveResponsesHealthToolExecutor({
        ...f.input,
        confirm,
        async resolveOwner(incoming) {
          const oldOwner = await f.input.resolveOwner(incoming);
          await Promise.resolve();
          if (scenario === 'locked') f.lock();
          else f.rotate();
          return oldOwner;
        },
      })(call, f.controller.signal);
      expect(confirm).not.toHaveBeenCalled();
      expect(f.read).not.toHaveBeenCalled();
      expect(f.settle).toHaveBeenCalledWith(
        call.callId,
        call.challengeId,
        null,
      );
    } finally {
      f.close();
    }
  },
);
