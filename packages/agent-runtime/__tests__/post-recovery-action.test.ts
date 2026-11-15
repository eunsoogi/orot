import { postRecoveryAction } from '../src/multiAgent/postRecoveryAction';
import type { LocalActionTool } from '../src/multiAgent/actionContracts';
function fixture() {
  const execute = jest.fn(async () => ({ items: [], coverage: [], conflicts: [] }));
  const authorize = jest.fn(async () => true);
  const action = postRecoveryAction(
    { execute, authorize } as unknown as LocalActionTool,
    'run',
    'tool-2',
    { text: 'old' },
  );
  const request = {
    input: { text: 'new' },
    operationRunId: 'run',
    operationKey: 'tool-3',
    signal: new AbortController().signal,
  };
  return { action, execute, authorize, request };
}

test('new distinct action needs its own one-use approval and increasing ordinal', async () => {
  const f = fixture();
  expect(await f.action.authorize({ text: 'old' }, f.request.signal)).toBe(false);
  expect(f.authorize).not.toHaveBeenCalled();
  await expect(f.action.execute(f.request)).rejects.toThrow();
  expect(await f.action.authorize(f.request.input, f.request.signal)).toBe(true);
  await f.action.execute(f.request);
  expect(f.execute).toHaveBeenCalledTimes(1);
  await f.action.authorize(f.request.input, f.request.signal);
  await expect(f.action.execute(f.request)).rejects.toThrow();
  expect(f.execute).toHaveBeenCalledTimes(1);
});

test.each(['old', 'owner', 'input', 'invalid', 'stop', 'denied'] as const)(
  'never dispatches an invalid later invocation: %s',
  async (mode) => {
    const f = fixture();
    if (mode === 'denied') f.authorize.mockResolvedValue(false);
    await f.action.authorize(f.request.input, f.request.signal);
    const request = { ...f.request };
    if (mode === 'old') request.operationKey = 'tool-2';
    if (mode === 'owner') request.operationRunId = 'other';
    if (mode === 'input') request.input = { text: 'other' };
    if (mode === 'invalid') request.operationKey = 'tool-3.5';
    if (mode === 'stop') {
      const c = new AbortController();
      c.abort();
      request.signal = c.signal;
    }
    await expect(f.action.execute(request)).rejects.toThrow();
    expect(f.execute).not.toHaveBeenCalled();
  },
);

test('a failed dispatched action never becomes retryable under a fresh grant', async () => {
  const f = fixture();
  f.execute.mockRejectedValue(new Error('unknown result'));
  await f.action.authorize(f.request.input, f.request.signal);
  await expect(f.action.execute(f.request)).rejects.toThrow('unknown result');
  await f.action.authorize(f.request.input, f.request.signal);
  await expect(f.action.execute(f.request)).rejects.toThrow('not authorized');
  expect(f.execute).toHaveBeenCalledTimes(1);
});

test('late approval cannot revive a cancelled or superseded grant', async () => {
  const f = fixture();
  let resolve!: (value: boolean) => void;
  f.authorize.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const pending = f.action.authorize({ text: 'earlier' }, f.request.signal);
  expect(await f.action.authorize(f.request.input, f.request.signal)).toBe(true);
  resolve(true);
  expect(await pending).toBe(false);
  await f.action.execute(f.request);
  expect(f.execute).toHaveBeenCalledTimes(1);
  const c = new AbortController();
  f.authorize.mockImplementationOnce(async () => {
    c.abort();
    return true;
  });
  expect(await f.action.authorize({ text: 'later' }, c.signal)).toBe(false);
});

test('an aborted approval cannot be used with a replacement execution signal', async () => {
  const f = fixture();
  const approval = new AbortController();
  await f.action.authorize(f.request.input, approval.signal);
  approval.abort();
  await expect(f.action.execute(f.request)).rejects.toThrow();
  expect(f.execute).not.toHaveBeenCalled();
});
