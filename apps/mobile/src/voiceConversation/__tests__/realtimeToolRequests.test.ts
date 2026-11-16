import {
  createRealtimeToolRequests,
  type RealtimeToolRequest,
} from '../realtimeToolRequests';
const request = {
  callId: 'call',
  responseId: 'response',
  toolCallId: 'tool',
  inputItemId: 'input',
};
const flush = async () => {
  for (let n = 0; n < 12; n++) await Promise.resolve();
};
function fixture() {
  let onCall = (_: RealtimeToolRequest) => {};
  let onCancel = (_id: string, _tool: string) => {};
  const native = {
    cancel: jest.fn(async () => {}),
    onToolCall: (listener: typeof onCall) => {
      onCall = listener;
      return jest.fn();
    },
    onToolCancelled: (listener: typeof onCancel) => {
      onCancel = listener;
      return jest.fn();
    },
    resolveToolCall: jest.fn(async () => true),
  };
  const execute = jest.fn(
    async (
      _text: string,
      _request: RealtimeToolRequest,
      _signal: AbortSignal,
    ): Promise<string | undefined> => 'approved output',
  );
  let active = true;
  const tools = createRealtimeToolRequests({
    native,
    current: id => active && id === 'call',
    execute,
  });
  return {
    tools,
    native,
    execute,
    call: (r = request) => onCall(r),
    cancel: () => onCancel('call', 'tool'),
    invalidate: () => {
      active = false;
    },
    transcript: (text = 'actual recognized speech') =>
      tools.observe({ callId: 'call', itemId: 'input', role: 'user', text }),
  };
}
test('never substitutes model arguments and waits for the matching immutable finalized transcript', async () => {
  const f = fixture();
  f.call();
  await flush();
  expect(f.execute).not.toHaveBeenCalled();
  f.tools.observe({
    callId: 'call',
    itemId: 'input',
    role: 'assistant',
    text: 'model-generated instruction',
  });
  expect(f.execute).not.toHaveBeenCalled();
  f.transcript();
  f.transcript('later replacement');
  await flush();
  expect(f.execute.mock.calls[0][0]).toBe('actual recognized speech');
  expect(f.native.resolveToolCall).toHaveBeenCalledWith(
    request,
    'approved output',
  );
  f.tools.dispose();
});
test('denial consumes the item and cannot dispatch a duplicate under a new tool id', async () => {
  const f = fixture();
  f.execute.mockResolvedValue(undefined);
  f.transcript();
  f.call();
  await flush();
  f.call({ ...request, toolCallId: 'other' });
  await flush();
  expect(f.execute).toHaveBeenCalledTimes(1);
  expect(f.native.resolveToolCall).toHaveBeenCalledWith(
    request,
    '{"status":"not_authorized"}',
  );
  f.tools.dispose();
});
test.each(['cancel', 'dispose', 'stale'] as const)(
  'does not send late completed output after %s',
  async kind => {
    const f = fixture();
    let resolve!: (value: string) => void;
    f.execute.mockImplementation(
      () =>
        new Promise(done => {
          resolve = done;
        }),
    );
    f.transcript();
    f.call();
    await flush();
    if (kind === 'cancel') f.cancel();
    else if (kind === 'dispose') f.tools.dispose();
    else f.invalidate();
    resolve('private synthetic result');
    await flush();
    expect(f.native.resolveToolCall).not.toHaveBeenCalled();
    f.tools.dispose();
  },
);
test('foreign call and oversized transcription never reach execution', async () => {
  const f = fixture();
  f.call({ ...request, callId: 'foreign' });
  f.transcript('가'.repeat(1001));
  f.call();
  await flush();
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.native.resolveToolCall).not.toHaveBeenCalled();
  f.tools.dispose();
});
test('thrown tool details never become output and cannot trigger replay', async () => {
  const f = fixture();
  f.execute.mockRejectedValue(new Error('synthetic private detail'));
  f.transcript();
  f.call();
  await flush();
  f.call();
  await flush();
  expect(f.execute).toHaveBeenCalledTimes(1);
  expect(f.native.resolveToolCall).not.toHaveBeenCalled();
  f.tools.dispose();
});
