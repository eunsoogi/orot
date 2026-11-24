import {
  beginConversationExecutionLease,
  type ConversationExecutionAdapter,
  type ConversationExecutionEvent,
} from '../conversationExecutionLease';

async function fixture(read: 'isActive' | 'protectedDataAvailable') {
  let emit!: (event: ConversationExecutionEvent) => void;
  let reject!: (reason: Error) => void;
  const pending = new Promise<boolean>((_, fail) => {
    reject = fail;
  });
  const adapter = {
    begin: jest.fn(async () => true),
    end: jest.fn(),
    currentPhase: () => 'active' as const,
    isActive: jest.fn(async (): Promise<boolean> => true),
    protectedDataAvailable: jest.fn(async (): Promise<boolean> => true),
    subscribe: (receive: (event: ConversationExecutionEvent) => void) => {
      emit = receive;
      return jest.fn();
    },
  } satisfies ConversationExecutionAdapter;
  const interrupt = jest.fn();
  const opportunity = jest.fn();
  const release = await beginConversationExecutionLease(
    adapter,
    'owner',
    interrupt,
    undefined,
    undefined,
    undefined,
    undefined,
    opportunity,
  );
  adapter.isActive.mockClear();
  adapter.protectedDataAvailable.mockClear();
  adapter[read].mockReturnValueOnce(pending);
  return { adapter, emit, interrupt, opportunity, reject, release };
}

const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

test.each(['isActive', 'protectedDataAvailable'] as const)(
  'rechecks exact ownership when prior-visit %s rejects after native activation',
  async read => {
    const f = await fixture(read);
    f.emit({ kind: 'foreground' });
    await flush();
    expect(f.adapter[read]).toHaveBeenCalledTimes(1);
    f.emit({ kind: 'continuation-foreground' });
    f.reject(new Error('synthetic old bridge read'));
    await flush();
    expect(f.interrupt).not.toHaveBeenCalled();
    expect(f.adapter[read]).toHaveBeenCalledTimes(2);
    expect(f.adapter.isActive).toHaveBeenLastCalledWith('owner');
    expect(f.opportunity).toHaveBeenCalledTimes(1);
    expect(f.opportunity).toHaveBeenCalledWith('continuation-foreground');
    f.release();
  },
);

test('a rejected current visit fails closed without reporting iOS expiry', async () => {
  const f = await fixture('isActive');
  f.emit({ kind: 'continuation-foreground' });
  await flush();
  f.reject(new Error('synthetic current bridge read'));
  await flush();
  expect(f.interrupt).toHaveBeenCalledTimes(1);
  expect(f.interrupt).toHaveBeenCalledWith('lease-check-failed');
  expect(f.opportunity).not.toHaveBeenCalled();
  f.release();
});

test('a genuine matching native expiry stays terminal after activation', async () => {
  const f = await fixture('isActive');
  f.emit({ kind: 'foreground' });
  await flush();
  f.emit({ kind: 'continuation-foreground' });
  f.emit({ kind: 'expired', requestId: 'owner' });
  f.reject(new Error('synthetic old bridge read'));
  await flush();
  expect(f.interrupt).toHaveBeenCalledTimes(1);
  expect(f.interrupt).toHaveBeenCalledWith('expired');
  expect(f.adapter.isActive).toHaveBeenCalledTimes(1);
  expect(f.opportunity).not.toHaveBeenCalled();
  f.release();
});
