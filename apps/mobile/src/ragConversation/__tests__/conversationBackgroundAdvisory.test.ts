import {
  beginConversationExecutionLease,
  type ConversationExecutionEvent,
} from '../conversationExecutionLease';

const tick = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

test('rapid foreground return revokes a held matching warning; the following background can accept a fresh one', async () => {
  let phase: 'active' | 'inactive' | 'background' = 'active';
  let emit!: (event: ConversationExecutionEvent) => void;
  let acknowledge!: (current: boolean) => void;
  const held = new Promise<boolean>(resolve => {
    acknowledge = resolve;
  });
  const active = jest.fn(async () => true);
  const pause = jest.fn();
  const interrupt = jest.fn();
  const now = jest
    .fn(async (_request: string, _warning: string) => true)
    .mockImplementationOnce(() => held);
  const close = await beginConversationExecutionLease(
    {
      currentPhase: () => phase,
      begin: async () => true,
      end: jest.fn(),
      isActive: active,
      protectedDataAvailable: async () => true,
      pauseStillCurrent: now,
      subscribe(listener) {
        emit = listener;
        return () => {};
      },
    },
    'request',
    interrupt,
    undefined,
    pause,
  );
  try {
    const event = (warning: string) =>
      ({ kind: 'pause-requested', requestId: 'request', warning }) as const;
    phase = 'background';
    emit({ kind: 'phase' });
    emit(event('first'));
    emit(event('first'));
    expect(now.mock.calls).toEqual([['request', 'first']]);
    expect(pause).not.toHaveBeenCalled();

    phase = 'inactive';
    emit({ kind: 'phase' });
    phase = 'active';
    emit({ kind: 'foreground' });
    acknowledge(true);
    await tick();
    expect(pause).not.toHaveBeenCalled();
    expect(interrupt).not.toHaveBeenCalled();

    phase = 'background';
    emit({ kind: 'phase' });
    emit(event('second'));
    await tick();
    expect(now.mock.calls).toEqual([
      ['request', 'first'],
      ['request', 'second'],
    ]);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(interrupt).not.toHaveBeenCalled();
    emit({ kind: 'expired', requestId: 'request' });
    expect(interrupt.mock.calls).toEqual([['expired']]);
  } finally {
    acknowledge(false);
    close();
  }
});

test('an exact continued-processing grant retires an already sampled short warning', async () => {
  let emit!: (event: ConversationExecutionEvent) => void;
  let settle!: (current: boolean) => void;
  const sampled = new Promise<boolean>(resolve => {
    settle = resolve;
  });
  const pause = jest.fn();
  const interrupt = jest.fn();
  const opportunity = jest.fn();
  const close = await beginConversationExecutionLease(
    {
      currentPhase: () => 'background',
      begin: async () => true,
      end: () => {},
      isActive: async () => true,
      protectedDataAvailable: async () => true,
      pauseStillCurrent: async () => sampled,
      subscribe(listener) {
        emit = listener;
        return () => {};
      },
    },
    'request',
    interrupt,
    undefined,
    pause,
    undefined,
    undefined,
    opportunity,
  );
  try {
    emit({ kind: 'pause-requested', requestId: 'request', warning: 'sampled' });
    emit({
      kind: 'continued',
      requestId: 'request',
      state: 'continued-granted',
    });
    settle(true);
    await tick();
    expect(opportunity.mock.calls).toEqual([['continued-granted']]);
    expect(pause).not.toHaveBeenCalled();
    emit({ kind: 'expired', requestId: 'request' });
    expect(interrupt.mock.calls).toEqual([['expired']]);
  } finally {
    settle(false);
    close();
  }
});
