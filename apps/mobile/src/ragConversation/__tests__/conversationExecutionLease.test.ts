import { conversationExecutionDiagnostics } from '../conversationExecutionDiagnostics';
import {
  beginConversationExecutionLease,
  type ConversationExecutionAdapter,
  type ConversationExecutionEvent,
} from '../conversationExecutionLease';

function fixture() {
  let listener: (event: ConversationExecutionEvent) => void = () => {};
  const adapter: ConversationExecutionAdapter = {
    begin: jest.fn().mockResolvedValue(true),
    end: jest.fn(),
    isActive: jest.fn().mockResolvedValue(true),
    protectedDataAvailable: jest.fn().mockResolvedValue(true),
    subscribe: callback => {
      listener = callback;
      return () => {
        listener = () => {};
      };
    },
  };
  return {
    adapter,
    emit: (event: ConversationExecutionEvent) => listener(event),
  };
}

test('expiration interrupts only its owner once and cleanup ends the lease', async () => {
  const f = fixture();
  const interrupt = jest.fn();
  const end = await beginConversationExecutionLease(
    f.adapter,
    'one',
    interrupt,
  );
  f.emit({ kind: 'expired', requestId: 'other' });
  expect(interrupt).not.toHaveBeenCalled();
  f.emit({ kind: 'expired', requestId: 'one' });
  f.emit({ kind: 'protectedData', available: false });
  expect(interrupt).toHaveBeenCalledTimes(1);
  expect(interrupt).toHaveBeenCalledWith('expired');
  end();
  end();
  f.emit({ kind: 'expired', requestId: 'one' });
  expect(f.adapter.end).toHaveBeenCalledTimes(1);
  expect(interrupt).toHaveBeenCalledTimes(1);
});

test('unavailable protected data interrupts before requesting execution', async () => {
  const f = fixture();
  jest.mocked(f.adapter.protectedDataAvailable).mockResolvedValue(false);
  const interrupt = jest.fn();
  const end = await beginConversationExecutionLease(
    f.adapter,
    'one',
    interrupt,
  );
  expect(interrupt).toHaveBeenCalledWith('protected-data');
  expect(f.adapter.begin).not.toHaveBeenCalled();
  end();
});

test('an unavailable lease interrupts instead of pretending work can continue', async () => {
  const f = fixture();
  jest.mocked(f.adapter.begin).mockResolvedValue(false);
  const interrupt = jest.fn();
  const end = await beginConversationExecutionLease(
    f.adapter,
    'one',
    interrupt,
  );
  expect(interrupt).toHaveBeenCalledWith('lease-denied');
  end();
  expect(f.adapter.end).not.toHaveBeenCalled();
});

test('protected data loss during lease acquisition still ends the eventual lease', async () => {
  const f = fixture();
  let finish!: (value: boolean) => void;
  let requested!: () => void;
  const started = new Promise<void>(resolve => {
    requested = resolve;
  });
  jest.mocked(f.adapter.begin).mockImplementation(() => {
    requested();
    return new Promise<boolean>(resolve => {
      finish = resolve;
    });
  });
  const interrupt = jest.fn();
  const pending = beginConversationExecutionLease(f.adapter, 'one', interrupt);
  await started;
  f.emit({ kind: 'protectedData', available: false });
  finish(true);
  const end = await pending;
  expect(interrupt).toHaveBeenCalledWith('protected-data');
  end();
  expect(f.adapter.end).toHaveBeenCalledWith('one');
});

test('foreground reconciliation catches an expiration whose event was missed', async () => {
  const f = fixture();
  const interrupt = jest.fn();
  const end = await beginConversationExecutionLease(
    f.adapter,
    'one',
    interrupt,
  );
  jest.mocked(f.adapter.isActive).mockResolvedValue(false);
  f.emit({ kind: 'foreground' });
  await Promise.resolve();
  await Promise.resolve();
  expect(interrupt).toHaveBeenCalledWith('expired');
  end();
});

test('a healthy foreground reconciliation leaves the in-flight request alone', async () => {
  const f = fixture();
  const interrupt = jest.fn();
  const end = await beginConversationExecutionLease(
    f.adapter,
    'one',
    interrupt,
  );
  f.emit({ kind: 'foreground' });
  await Promise.resolve();
  await Promise.resolve();
  expect(interrupt).not.toHaveBeenCalled();
  end();
});

test('a failed lease check is not reported as an observed OS expiration', async () => {
  const f = fixture();
  jest.mocked(f.adapter.isActive).mockRejectedValue(new Error('synthetic'));
  const interrupt = jest.fn();
  const end = await beginConversationExecutionLease(
    f.adapter,
    'one',
    interrupt,
  );
  expect(interrupt).toHaveBeenCalledWith('lease-check-failed');
  end();
});

test('phase observations retain lease ownership without interrupting healthy work', async () => {
  const f = fixture();
  let phase: 'active' | 'background' = 'active';
  f.adapter.currentPhase = () => phase;
  const interrupt = jest.fn();
  const end = await beginConversationExecutionLease(
    f.adapter,
    'private-id',
    interrupt,
  );
  const owner = conversationExecutionDiagnostics().at(-1)!.sequence;
  phase = 'background';
  f.emit({ kind: 'phase' });
  phase = 'active';
  f.emit({ kind: 'foreground' });
  await Promise.resolve();
  await Promise.resolve();
  end();
  const observations = conversationExecutionDiagnostics().filter(
    item => item.sequence === owner,
  );
  expect(observations.map(item => item.event)).toEqual([
    'begin',
    'acquired',
    'phase',
    'foreground',
    'release',
  ]);
  expect(observations[2].phase).toBe('background');
  expect(JSON.stringify(observations)).not.toContain('private-id');
  expect(interrupt).not.toHaveBeenCalled();
});
