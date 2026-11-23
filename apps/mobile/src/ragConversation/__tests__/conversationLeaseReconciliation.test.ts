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

test('a queued foreground recheck still catches missing ownership', async () => {
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
  expect(f.interrupt).toHaveBeenCalledWith('lease-check-failed');
  expect(f.adapter.isActive).toHaveBeenCalledTimes(2);
  f.release();
});

test('missing at an active-only foreground check is not evidence of iOS expiration', async () => {
  const f = await fixture();
  f.adapter.currentPhase = () => 'active';
  jest.mocked(f.adapter.isActive).mockResolvedValue(false);
  f.emit({ kind: 'foreground' });
  await flush();
  expect(f.interrupt).toHaveBeenCalledWith('lease-check-failed');
  f.release();
});

test('a lease lost before a background-start check is not OS expiry evidence', async () => {
  const f = await fixture();
  f.release();
  f.adapter.currentPhase = () => 'background';
  jest.mocked(f.adapter.isActive).mockResolvedValueOnce(false);
  const interrupt = jest.fn();
  const diagnose = jest.fn();
  const release = await beginConversationExecutionLease(
    f.adapter,
    'startup',
    interrupt,
    undefined,
    undefined,
    diagnose,
  );
  expect(interrupt).toHaveBeenCalledWith('lease-check-failed');
  expect(diagnose).toHaveBeenCalledWith('startup-lease-unavailable');
  release();
});

test('a matching native expiry wins over a pending boolean loss and a foreign expiry does not count', async () => {
  const f = await fixture();
  f.release();
  f.adapter.currentPhase = () => 'active';
  const interrupt = jest.fn();
  const diagnose = jest.fn();
  const release = await beginConversationExecutionLease(
    f.adapter,
    'exact-owner',
    interrupt,
    undefined,
    undefined,
    diagnose,
  );
  const pending = deferred<boolean>();
  jest.mocked(f.adapter.isActive).mockImplementationOnce(() => pending.promise);
  f.emit({ kind: 'foreground' });
  await flush();
  f.emit({ kind: 'expired', requestId: 'foreign-owner' });
  expect(diagnose).not.toHaveBeenCalledWith('native-expiration');
  f.emit({ kind: 'expired', requestId: 'exact-owner' });
  pending.resolve(false);
  await flush();
  expect(interrupt.mock.calls).toEqual([['expired']]);
  expect(diagnose).toHaveBeenCalledWith('native-expiration');
  expect(diagnose).not.toHaveBeenCalledWith('foreground-lease-unavailable');
  release();
});

test('fallback bridge loss and ignored shown-final expiry never count as native expiration', async () => {
  const f = await fixture();
  f.release();
  const interrupt = jest.fn();
  const diagnose = jest.fn();
  const release = await beginConversationExecutionLease(
    f.adapter,
    'owner',
    interrupt,
    undefined,
    undefined,
    diagnose,
    () => false,
  );
  f.emit({ kind: 'expired', requestId: 'owner' });
  expect(interrupt).not.toHaveBeenCalled();
  f.emit({ kind: 'expired', requestId: 'owner', reason: 'bridge-unavailable' });
  expect(interrupt.mock.calls).toEqual([['bridge-unavailable']]);
  expect(diagnose).not.toHaveBeenCalledWith('native-expiration');
  release();
});

test('a broken diagnostic cannot suppress the exact native cancellation or lease cleanup', async () => {
  const f = await fixture();
  f.release();
  const interrupt = jest.fn();
  const diagnose = jest.fn(() => {
    throw new Error('synthetic diagnostic unavailable');
  });
  const release = await beginConversationExecutionLease(
    f.adapter,
    'owner',
    interrupt,
    undefined,
    undefined,
    diagnose,
  );
  f.emit({ kind: 'expired', requestId: 'owner' });
  expect(interrupt.mock.calls).toEqual([['expired']]);
  release();
  expect(f.adapter.end).toHaveBeenLastCalledWith('owner');
});

test('a background advisory delivered during an already active native phase does not drain the owner', async () => {
  const f = await fixture();
  f.release();
  const pause = jest.fn();
  const current = jest.fn(async () => false);
  Object.assign(f.adapter, { pauseStillCurrent: current });
  f.adapter.currentPhase = () => 'active';
  const release = await beginConversationExecutionLease(
    f.adapter,
    'owner',
    f.interrupt,
    undefined,
    pause,
  );
  const old = {
    kind: 'pause-requested',
    requestId: 'owner',
    warning: 'stale-warning',
  } as const;
  f.emit(old);
  await flush();
  try {
    expect(current).toHaveBeenCalledWith('owner', old.warning);
    expect(pause).not.toHaveBeenCalled();
    f.emit({ kind: 'expired', requestId: 'owner' });
    expect(f.interrupt.mock.calls).toEqual([['expired']]);
  } finally {
    release();
  }
});
