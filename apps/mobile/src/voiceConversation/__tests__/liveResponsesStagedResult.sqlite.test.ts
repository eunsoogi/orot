import { stageLiveResponsesResult } from '../stageLiveResponsesResult';
import { createLiveResponsesHealthToolExecutor } from '../liveResponsesHealthToolExecutor';
import { call, fixture } from '../testSupport/liveResponsesProtectedFixture';

test.each(['unchanged', 'edited', 'stopped', 'revoked', 'replaced'] as const)(
  'a held final protected proof for %s result settles only the originally approved current bytes',
  async mode => {
    const f = await fixture();
    try {
      let release!: () => void;
      const held = new Promise<void>(resolve => {
        release = resolve;
      });
      let entered!: () => void;
      const checking = new Promise<void>(resolve => {
        entered = resolve;
      });
      const original = f.read.getMockImplementation()!;
      let approved: string | undefined;
      let authorized = true;
      const confirm = jest.fn(async () => true);
      const authorizeResult = jest.fn(async (_authority, output: string) => {
        approved = output;
        f.read.mockImplementationOnce(async (...args) => {
          entered();
          await held;
          return original(...args);
        });
        return () => authorized;
      });
      const execute = createLiveResponsesHealthToolExecutor({
        ...f.input,
        confirm,
        authorizeResult,
      });
      const running = execute(call, f.controller.signal);
      await checking;
      expect(f.settle).not.toHaveBeenCalled();
      await execute(call, f.controller.signal);
      if (mode === 'edited') await f.edit();
      if (mode === 'stopped') f.controller.abort();
      if (mode === 'revoked') authorized = false;
      if (mode === 'replaced')
        f.setActive({ ...call, challengeId: 'replacement' });
      release();
      await running;
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(authorizeResult).toHaveBeenCalledTimes(1);
      if (mode === 'unchanged')
        expect(f.settle.mock.calls).toEqual([
          [call.callId, call.challengeId, approved],
        ]);
      else
        expect(
          f.settle.mock.calls.every(([, , output]) => output === null),
        ).toBe(true);
    } finally {
      f.close();
    }
  },
);

test('staging sends nothing and two admission contenders cannot replay the approved result', async () => {
  let release!: (stillCurrent: boolean) => void;
  const source = new Promise<boolean>(resolve => {
    release = resolve;
  });
  const reproveSource = jest.fn(() => source);
  const handoff = jest.fn(async (_approved: string) => undefined);
  const staged = stageLiveResponsesResult({
    output: 'synthetic-approved-bytes',
    signal: new AbortController().signal,
    current: () => true,
    reproveSource,
  });
  expect(handoff).not.toHaveBeenCalled();
  const admitting = staged.admit(handoff);
  await staged.admit(handoff);
  expect(reproveSource).toHaveBeenCalledTimes(1);
  expect(handoff).not.toHaveBeenCalled();
  release(true);
  await admitting;
  await staged.admit(handoff);
  expect(handoff.mock.calls).toEqual([['synthetic-approved-bytes']]);
});
