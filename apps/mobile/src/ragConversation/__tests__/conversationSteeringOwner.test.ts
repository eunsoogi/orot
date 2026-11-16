import { createConversationSteeringOwner } from '../conversationSteeringOwner';
import { createEmptyConversation } from '../conversationEmptySession';
import type { WorkflowOperationJournal } from '@orot/agent-runtime';
function fixture() {
  let session = {
    ...createEmptyConversation(1),
    draft: 'Synthetic instruction',
  };
  const owner = createConversationSteeringOwner(
    () => session,
    (_id, change) => {
      session = { ...session, ...change };
    },
  );
  const store: NonNullable<WorkflowOperationJournal['steering']> = {
    enqueue: jest.fn(async () => true),
    list: async () => [],
    bind: async () => undefined,
    acknowledge: async () => false,
  };
  return { owner, store, session: () => session };
}
test('repeated submission while a write waits does not duplicate and retains changed drafts', async () => {
  const f = fixture();
  let release!: (value: boolean) => void;
  const enqueue = jest.fn(
    () =>
      new Promise<boolean>(resolve => {
        release = resolve;
      }),
  );
  f.store.enqueue = enqueue;
  f.owner.bind(1, f.store, () => true);
  const pending = f.owner.submit(1);
  await f.owner.submit(1);
  expect(enqueue).toHaveBeenCalledTimes(1);
  release(false);
  await pending;
  expect(f.session().draft).toBe('Synthetic instruction');
  expect(f.session().steeringError).toBe(true);
});
test('an old request finishing cannot remove a newer steering owner', async () => {
  const f = fixture();
  const old = () => false;
  f.owner.bind(1, f.store, old);
  const current = () => true;
  f.owner.bind(1, f.store, current);
  f.owner.finish(1, old);
  await f.owner.submit(1);
  expect(f.store.enqueue).toHaveBeenCalledTimes(1);
  expect(f.session().draft).toBe('');
});

test('a stale late binding cannot displace the current request owner', async () => {
  const f = fixture();
  const stale = { ...f.store, enqueue: jest.fn(async () => true) };
  f.owner.bind(1, f.store, () => true);
  f.owner.bind(1, stale, () => false);
  await f.owner.submit(1);
  expect(f.store.enqueue).toHaveBeenCalledTimes(1);
  expect(stale.enqueue).not.toHaveBeenCalled();
});

test('resumable detach preserves queued delivery until restored durable receipt', async () => {
  const f = fixture();
  const row = {
    id: 's1',
    text: 'Synthetic',
    sequence: 1,
    status: 'queued' as const,
  };
  f.store.list = async () => [row];
  const current = () => true;
  f.owner.bind(1, f.store, current);
  await Promise.resolve();
  f.owner.finish(1, current, true);
  expect(f.session().steeringInstructions).toEqual([row]);
  f.store.list = async () => [{ ...row, status: 'applied' }];
  f.owner.bind(1, f.store, () => true);
  await Promise.resolve();
  expect(f.session().steeringInstructions?.[0].status).toBe('applied');
});

test('empty refreshed durable list clears retained private instructions', async () => {
  const f = fixture();
  let notify!: () => Promise<void>;
  f.store.subscribe = listener => {
    notify = listener;
    return () => {};
  };
  f.store.list = async () => [
    { id: 's1', text: 'Synthetic', sequence: 1, status: 'applied' },
  ];
  f.owner.bind(1, f.store, () => true);
  await Promise.resolve();
  f.store.list = async () => [];
  await notify();
  expect(f.session().steeringInstructions).toEqual([]);
});

test('invalidation fences pending refresh and enqueue receipts immediately', async () => {
  const f = fixture();
  let read!: (rows: Awaited<ReturnType<typeof f.store.list>>) => void;
  let write!: (accepted: boolean) => void;
  f.store.list = () =>
    new Promise(resolve => {
      read = resolve;
    });
  f.store.enqueue = () =>
    new Promise(resolve => {
      write = resolve;
    });
  f.owner.bind(1, f.store, () => true);
  const pending = f.owner.submit(1);
  f.owner.clear(1);
  read([{ id: 's1', text: 'Synthetic', sequence: 1, status: 'applied' }]);
  write(true);
  await pending;
  expect(f.session().steeringInstructions).toEqual([]);
  expect(f.session().steeringAvailable).toBe(false);
  expect(f.session().draft).toBe('Synthetic instruction');
});
