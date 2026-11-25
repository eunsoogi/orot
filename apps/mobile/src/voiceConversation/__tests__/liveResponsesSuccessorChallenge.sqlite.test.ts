import { createLiveResponsesHealthToolExecutor } from '../liveResponsesHealthToolExecutor';
import { call, fixture } from '../testSupport/liveResponsesProtectedFixture';

test('only an exact current successor call gets a fresh tool challenge budget', async () => {
  const f = await fixture();
  try {
    let available = false;
    const confirm = jest.fn(async () => true);
    const execute = createLiveResponsesHealthToolExecutor({
      ...f.input,
      protectedDataAvailable: async () =>
        available && f.input.protectedDataAvailable(),
      confirm,
    });

    for (let index = 0; index < 128; index += 1) {
      const next = { ...call, challengeId: 'challenge-' + index };
      f.setActive(next);
      await execute(next, f.controller.signal);
    }
    expect(f.settle).toHaveBeenCalledTimes(128);
    expect(f.read).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();

    const previous = { ...call, challengeId: 'challenge-0' };
    f.setActive(previous);
    await execute(previous, f.controller.signal);
    expect(f.settle).toHaveBeenCalledTimes(128);

    const overflow = { ...call, challengeId: 'overflow' };
    f.setActive(overflow);
    available = true;
    await execute(overflow, f.controller.signal);
    expect(f.settle).toHaveBeenLastCalledWith(call.callId, 'overflow', null);
    expect(f.read).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();

    const successor = {
      ...previous,
      callId: 'next-call',
      sessionId: 2,
      delegationId: 'next-delegation',
    };
    f.setActive(successor);
    await execute(previous, f.controller.signal);
    await execute(successor, f.controller.signal);
    await execute(successor, f.controller.signal);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(f.settle).toHaveBeenCalledTimes(130);
    expect(f.settle).toHaveBeenLastCalledWith(
      successor.callId,
      successor.challengeId,
      expect.any(String),
    );
    expect(f.settle.mock.calls.at(-1)?.[2]).not.toContain(
      'synthetic-health-id',
    );
  } finally {
    f.close();
  }
});
