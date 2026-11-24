import type { WorkflowOperationJournal } from '@orot/agent-runtime';
import { createEmptyConversation } from '../conversationEmptySession';
import {
  beginConversationExecutionLease,
  type ConversationExecutionAdapter,
  type ConversationExecutionEvent,
} from '../conversationExecutionLease';
import type { ConversationSession } from '../conversationSessionTypes';
import { createConversationSteeringOwner } from '../conversationSteeringOwner';

function held<T>() {
  let open!: (value: T) => void;
  const result = new Promise<T>(resolve => {
    open = resolve;
  });
  return { result, open };
}
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

async function fixture() {
  const id = 17;
  const requestId = 'synthetic-owner';
  const controller = new AbortController();
  let phase: 'active' | 'inactive' | 'background' = 'active';
  let emit!: (event: ConversationExecutionEvent) => void;
  const heldCheck = held<boolean>();
  const adapter: ConversationExecutionAdapter = {
    begin: jest.fn(async () => true),
    currentPhase: () => phase,
    end: jest.fn(),
    isActive: jest.fn(async () => true),
    protectedDataAvailable: jest.fn(async () => true),
    subscribe: listen => {
      emit = listen;
      return jest.fn();
    },
  };
  const interrupt = jest.fn(() => controller.abort());
  const release = await beginConversationExecutionLease(
    adapter,
    requestId,
    interrupt,
  );
  jest
    .mocked(adapter.isActive)
    .mockClear()
    .mockReturnValueOnce(heldCheck.result);
  const write = held<boolean>();
  const journal: NonNullable<WorkflowOperationJournal['steering']> = {
    enqueue: jest.fn(() => write.result),
    list: async () => [],
    bind: async () => undefined,
    acknowledge: async () => false,
  };
  let session: ConversationSession = {
    ...createEmptyConversation(id),
    draft: 'Synthetic follow-up',
  };
  const owner = createConversationSteeringOwner(
    () => session,
    (_id, change) => {
      session = { ...session, ...change };
    },
  );
  owner.bind(id, journal, () => !controller.signal.aborted);
  const pending = owner.submit(id);
  emit({ kind: 'foreground' });
  await flush();
  return {
    adapter,
    controller,
    interrupt,
    journal,
    pending,
    heldCheck,
    write,
    emit,
    requestId,
    changePhase(next: typeof phase) {
      phase = next;
      emit({ kind: next === 'active' ? 'foreground' : 'phase' });
    },
    read: () => session,
    close() {
      release();
      owner.dispose();
    },
  };
}

test.each(['inactive', 'background'] as const)(
  'ignores an old lease sample during held steering after %s and a verified active return',
  async phase => {
    const f = await fixture();
    try {
      expect(f.adapter.isActive).toHaveBeenCalledTimes(1);
      expect(f.journal.enqueue).toHaveBeenCalledTimes(1);
      f.changePhase('inactive');
      if (phase === 'background') f.changePhase('background');
      f.changePhase('active');
      f.heldCheck.open(false);
      await flush();
      expect(f.adapter.isActive).toHaveBeenCalledTimes(2);
      expect(f.interrupt).not.toHaveBeenCalled();
      expect(f.controller.signal.aborted).toBe(false);
      f.write.open(true);
      await f.pending;
      expect(f.read().draft).toBe('');
      expect(f.journal.enqueue).toHaveBeenCalledTimes(1);
    } finally {
      f.write.open(false);
      f.close();
    }
  },
);

test('a native active return supersedes a parked false check before AppState catches up', async () => {
  const f = await fixture();
  try {
    expect(f.adapter.isActive).toHaveBeenCalledTimes(1);
    expect(f.journal.enqueue).toHaveBeenCalledTimes(1);
    // UIKit and the execution bridge reported active again before the RN
    // inactive/active events reached JS. The pending result is from before return.
    f.emit({ kind: 'continuation-foreground' });
    f.heldCheck.open(false);
    await flush();
    expect(f.adapter.isActive).toHaveBeenCalledTimes(2);
    expect(f.interrupt).not.toHaveBeenCalled();
    f.write.open(true);
    await f.pending;
    expect(f.read().draft).toBe('');
    expect(f.journal.enqueue).toHaveBeenCalledTimes(1);
  } finally {
    f.write.open(false);
    f.close();
  }
});

test('a native active return still checks actual current ownership', async () => {
  const f = await fixture();
  try {
    jest.mocked(f.adapter.isActive).mockResolvedValueOnce(false);
    f.emit({ kind: 'continuation-foreground' });
    f.heldCheck.open(false);
    await flush();
    expect(f.adapter.isActive).toHaveBeenCalledTimes(2);
    expect(f.interrupt).toHaveBeenCalledTimes(1);
    expect(f.interrupt).toHaveBeenCalledWith('lease-check-failed');
  } finally {
    f.write.open(false);
    await f.pending;
    f.close();
  }
});

test('a verified current loss or matching native expiration retains its real meaning', async () => {
  const current = await fixture();
  current.heldCheck.open(false);
  await flush();
  expect(current.interrupt).toHaveBeenCalledWith('lease-check-failed');
  current.write.open(true);
  await current.pending;
  expect(current.read().draft).toBe('Synthetic follow-up');
  current.close();

  const genuine = await fixture();
  genuine.changePhase('background');
  genuine.emit({ kind: 'expired', requestId: 'different-owner' });
  expect(genuine.interrupt).not.toHaveBeenCalled();
  genuine.emit({ kind: 'expired', requestId: genuine.requestId });
  expect(genuine.interrupt).toHaveBeenCalledWith('expired');
  genuine.changePhase('active');
  genuine.heldCheck.open(true);
  genuine.write.open(true);
  await genuine.pending;
  expect(genuine.read().draft).toBe('Synthetic follow-up');
  expect(genuine.journal.enqueue).toHaveBeenCalledTimes(1);
  genuine.close();
});
