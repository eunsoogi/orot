import {
  beginConversationExecutionLease,
  type ConversationExecutionAdapter,
  type ConversationExecutionEvent,
} from '../conversationExecutionLease';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture() {
  let emit!: (event: ConversationExecutionEvent) => void;
  const adapter: ConversationExecutionAdapter = {
    begin: jest.fn(async () => true),
    end: jest.fn(),
    isActive: jest.fn(async () => true),
    protectedDataAvailable: jest.fn(async () => true),
    subscribe: listener => {
      emit = listener;
      return jest.fn();
    },
  };
  const interrupt = jest.fn();
  const release = await beginConversationExecutionLease(
    adapter,
    'owner',
    interrupt,
  );
  jest.mocked(adapter.isActive).mockClear();
  jest.mocked(adapter.protectedDataAvailable).mockClear();
  return {
    adapter,
    interrupt,
    release,
    emit: (event: ConversationExecutionEvent) => emit(event),
  };
}
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

// Both native and AppState can announce foreground; never create parallel bridge reads.
test('coalesces a foreground burst but reconciles the latest notification', async () => {
  const f = await fixture();
  const first = deferred<boolean>();
  jest
    .mocked(f.adapter.protectedDataAvailable)
    .mockImplementationOnce(() => first.promise);
  f.emit({ kind: 'foreground' });
  for (let i = 0; i < 50; i++) f.emit({ kind: 'foreground' });
  expect(f.adapter.protectedDataAvailable).toHaveBeenCalledTimes(1);
  first.resolve(true);
  await flush();
  expect(f.adapter.protectedDataAvailable).toHaveBeenCalledTimes(2);
  expect(f.adapter.isActive).toHaveBeenCalledTimes(2);
  expect(f.interrupt).not.toHaveBeenCalled();
  f.release();
});

test.each(['release', 'expired', 'protectedData'] as const)(
  'ends queued reconciliation after %s',
  async boundary => {
    const f = await fixture();
    const pending = deferred<boolean>();
    jest
      .mocked(f.adapter.protectedDataAvailable)
      .mockImplementationOnce(() => pending.promise);
    f.emit({ kind: 'foreground' });
    f.emit({ kind: 'foreground' });
    if (boundary === 'release') f.release();
    else if (boundary === 'expired')
      f.emit({ kind: 'expired', requestId: 'owner' });
    else f.emit({ kind: 'protectedData', available: false });
    pending.resolve(true);
    await flush();
    expect(f.adapter.isActive).not.toHaveBeenCalled();
    expect(f.adapter.protectedDataAvailable).toHaveBeenCalledTimes(1);
    expect(f.interrupt).toHaveBeenCalledTimes(boundary === 'release' ? 0 : 1);
    f.release();
  },
);

test('a queued foreground recheck still catches a missed expiration', async () => {
  const f = await fixture();
  const pending = deferred<boolean>();
  jest
    .mocked(f.adapter.isActive)
    .mockImplementationOnce(() => pending.promise)
    .mockResolvedValue(false);
  f.emit({ kind: 'foreground' });
  await flush();
  f.emit({ kind: 'foreground' });
  pending.resolve(true);
  await flush();
  expect(f.interrupt).toHaveBeenCalledWith('expired');
  expect(f.adapter.isActive).toHaveBeenCalledTimes(2);
  f.release();
});
