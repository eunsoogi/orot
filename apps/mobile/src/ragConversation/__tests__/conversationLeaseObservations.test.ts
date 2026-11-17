import {
  beginConversationExecutionLease,
  type ConversationExecutionAdapter,
  type ConversationExecutionEvent,
} from '../conversationExecutionLease';
import { conversationExecutionDiagnostics } from '../conversationExecutionDiagnostics';

/** Synthetic bridge promises expose observation timing without accessing a device. */
async function fixture() {
  let emit: (event: ConversationExecutionEvent) => void = () => {};
  const adapter: ConversationExecutionAdapter = {
    begin: jest.fn().mockResolvedValue(true),
    end: jest.fn(),
    isActive: jest.fn().mockResolvedValue(true),
    protectedDataAvailable: jest.fn().mockResolvedValue(true),
    subscribe: listener => {
      emit = listener;
      return () => {};
    },
  };
  const interrupt = jest.fn();
  const pause = jest.fn();
  const end = await beginConversationExecutionLease(
    adapter,
    'synthetic',
    interrupt,
    () => false,
    pause,
  );
  const sequence = conversationExecutionDiagnostics().at(-1)!.sequence;
  return {
    adapter,
    emit,
    end,
    interrupt,
    pause,
    events: () =>
      conversationExecutionDiagnostics()
        .filter(item => item.sequence === sequence)
        .map(item => item.event),
  };
}
const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

test('observes actual serialized checks, not each duplicate foreground notification', async () => {
  const f = await fixture();
  let finish!: (value: boolean) => void;
  jest.mocked(f.adapter.protectedDataAvailable).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  f.emit({ kind: 'foreground' });
  f.emit({ kind: 'foreground' });
  f.emit({ kind: 'foreground' });
  expect(
    f.events().filter(event => event === 'foreground-check-started'),
  ).toHaveLength(1);
  expect(f.events()).not.toContain('foreground-check-passed');
  finish(true);
  await tick();
  expect(
    f.events().filter(event => event.startsWith('foreground-check')),
  ).toEqual([
    'foreground-check-started',
    'foreground-check-passed',
    'foreground-check-started',
    'foreground-check-passed',
  ]);
  expect(f.interrupt).not.toHaveBeenCalled();
  f.end();
});

test.each(['release', 'protected-data', 'expiration'] as const)(
  'never reports late success after %s',
  async retirement => {
    const f = await fixture();
    let finish!: (value: boolean) => void;
    jest.mocked(f.adapter.isActive).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
    f.emit({ kind: 'foreground' });
    await tick();
    if (retirement === 'release') f.end();
    else if (retirement === 'protected-data')
      f.emit({ kind: 'protectedData', available: false });
    else f.emit({ kind: 'expired', requestId: 'synthetic' });
    finish(true);
    await tick();
    expect(f.events()).toContain('foreground-check-started');
    expect(f.events()).not.toContain('foreground-check-passed');
    f.end();
  },
);

test.each(['protected', 'inactive', 'error'] as const)(
  'failed %s check never records success',
  async failure => {
    const f = await fixture();
    if (failure === 'protected')
      jest.mocked(f.adapter.protectedDataAvailable).mockResolvedValue(false);
    else if (failure === 'inactive')
      jest.mocked(f.adapter.isActive).mockResolvedValue(false);
    else
      jest.mocked(f.adapter.isActive).mockRejectedValue(new Error('synthetic'));
    f.emit({ kind: 'foreground' });
    await tick();
    expect(f.events()).toContain('foreground-check-started');
    expect(f.events()).not.toContain('foreground-check-passed');
    expect(f.interrupt).toHaveBeenCalledTimes(1);
    f.end();
  },
);

test('records one owned pause request without inventing a pause completion', async () => {
  const f = await fixture();
  f.emit({ kind: 'pause-requested', requestId: 'other' });
  f.emit({ kind: 'pause-requested', requestId: 'synthetic' });
  f.emit({ kind: 'pause-requested', requestId: 'synthetic' });
  f.end();
  f.emit({ kind: 'pause-requested', requestId: 'synthetic' });
  expect(f.events().filter(event => event === 'pause-requested')).toHaveLength(
    1,
  );
  expect(f.pause).toHaveBeenCalledTimes(1);
  expect(f.interrupt).not.toHaveBeenCalled();
});
