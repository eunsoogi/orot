import { createConversationSessionRetention } from '../../ragConversation/conversationSessionRetention';
import { createDailyReminderConversationOwner } from '../dailyReminderConversationOwner';
import {
  dailyReminderIntentStore,
  validDailyReminderConversationOwner,
} from '../dailyReminderIntentStore';
import { parseDailyReminderEntry } from '../dailyReminderDelivery';
import type { ConversationSessions } from '../../ragConversation/conversationSessions';
import type { ConversationSessionOptions } from '../../ragConversation/conversationSessionTypes';

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked' },
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(async () => true),
}));
const entry = parseDailyReminderEntry(
  { kind: 'daily_report', deliveryTimestamp: '1700000000' },
  'Asia/Seoul',
)!;
const createdAt = '2023-11-15T00:00:00.000Z';
function fixture() {
  let activeId = 1;
  const rows = [
    { id: 1, createdAt },
    { id: 2, createdAt },
  ];
  const leases = new Map<number, { id: string; version: number }>();
  const beginSession = jest.fn(async (id: number) => {
    const lease = { id: `session-${id}`, version: 3 };
    leases.set(id, lease);
    return lease;
  });
  const attachExisting = jest.fn(async (id: string, version: number) => {
    leases.set(3, { id, version });
    rows.push({ id: 3, createdAt });
    return 3;
  });
  const sessions = {
    getSnapshot: () => ({ activeId, sessions: rows }),
    attachExisting,
  } as unknown as ConversationSessions;
  const retention = {
    beginSession,
    activeLease: (id: number) => leases.get(id) ?? null,
  } as unknown as NonNullable<ConversationSessionOptions['retention']>;
  const signal = new AbortController().signal;
  const isCurrent = jest.fn(() => true);
  return {
    sessions,
    retention,
    signal,
    isCurrent,
    beginSession,
    attachExisting,
    leases,
    rows,
    select: (id: number) => {
      activeId = id;
    },
  };
}
afterEach(() => jest.restoreAllMocks());

test('binds before card work and preserves its exact durable owner after session switching and restart', async () => {
  const input = fixture();
  const write = jest
    .spyOn(dailyReminderIntentStore, 'write')
    .mockResolvedValue();
  const resolve = createDailyReminderConversationOwner(input);
  expect(await resolve(entry)).toBe(1);
  const bound = write.mock.calls[0]![0].entry;
  expect(bound.conversationOwner).toEqual({
    id: 'session-1',
    version: 3,
    createdAt,
  });
  expect(input.beginSession).toHaveBeenCalledWith(1, input.signal);
  input.select(2);
  expect(await resolve(bound)).toBe(1);
  expect(input.beginSession).toHaveBeenCalledTimes(1);
  input.leases.clear();
  expect(await createDailyReminderConversationOwner(input)(bound)).toBe(3);
  expect(input.attachExisting).toHaveBeenCalledWith(
    'session-1',
    3,
    createdAt,
    false,
    input.isCurrent,
    input.signal,
  );
  expect(input.sessions.getSnapshot().activeId).toBe(2);
});

test('memory-only retries retain the first numeric owner, never a newly selected session', async () => {
  const input = fixture();
  const resolve = createDailyReminderConversationOwner({
    ...input,
    retention: undefined,
  });
  expect(await resolve(entry)).toBe(1);
  input.select(2);
  expect(await resolve(entry)).toBe(1);
});

test('does not silently downgrade a production caller without beginSession', async () => {
  const input = fixture();
  input.retention.beginSession = undefined;
  await expect(
    createDailyReminderConversationOwner(input)(entry),
  ).rejects.toThrow('storage is unavailable');
});

test.each([
  null,
  {},
  { id: 'x', version: -1, createdAt },
  { id: 'x', version: 1, createdAt: 'invalid' },
  { id: 'x', version: 1, createdAt, text: 'not allowed' },
])(
  'rejects malformed owner %j instead of binding another session',
  async owner => {
    const input = fixture();
    expect(validDailyReminderConversationOwner(owner)).toBe(false);
    await expect(
      createDailyReminderConversationOwner(input)({
        ...entry,
        conversationOwner: owner as never,
      }),
    ).rejects.toThrow('Invalid reminder');
    expect(input.beginSession).not.toHaveBeenCalled();
  },
);

test.each(['busy', 'restoring', 'restoreFailed', 'quarantined'])(
  'rejects %s owner before binding',
  async flag => {
    const input = fixture();
    Object.assign(input.rows[0]!, { [flag]: true });
    await expect(
      createDailyReminderConversationOwner(input)(entry),
    ).rejects.toThrow('unavailable');
    expect(input.beginSession).not.toHaveBeenCalled();
  },
);

test('does not bind after current owner changes during beginSession', async () => {
  const input = fixture();
  const write = jest
    .spyOn(dailyReminderIntentStore, 'write')
    .mockResolvedValue();
  input.beginSession.mockImplementation(async () => {
    input.isCurrent.mockReturnValue(false);
    return { id: 'session-1', version: 3 };
  });
  await expect(
    createDailyReminderConversationOwner(input)(entry),
  ).rejects.toThrow('no longer current');
  expect(write).not.toHaveBeenCalled();
});

test('rejects an aborted request without beginning a lease', async () => {
  const input = fixture();
  const cancellation = new AbortController();
  cancellation.abort();
  await expect(
    createDailyReminderConversationOwner({
      ...input,
      signal: cancellation.signal,
    })(entry),
  ).rejects.toThrow('no longer current');
  expect(input.beginSession).not.toHaveBeenCalled();
});

test('rejects a lease changed while the durable binding is written', async () => {
  const input = fixture();
  jest.spyOn(dailyReminderIntentStore, 'write').mockImplementation(async () => {
    input.leases.set(1, { id: 'session-1', version: 4 });
  });
  await expect(
    createDailyReminderConversationOwner(input)(entry),
  ).rejects.toThrow('lease changed');
});

test('store rejects malformed owner metadata before sending it to protected storage', async () => {
  await expect(
    dailyReminderIntentStore.write({
      active: true,
      entry: {
        ...entry,
        conversationOwner: { id: 'session-1', version: -1, createdAt },
      },
    }),
  ).rejects.toThrow('Invalid reminder conversation owner');
});

// Exercise the real ensureSession initializer, not a mocked positive-version lease.
test('binds a newly created production retention lease at version zero', async () => {
  const input = fixture();
  const storage = {
    currentGeneration: jest.fn(async () => 0),
    createSession: jest.fn(async () => undefined),
    activeSessionVersion: jest.fn(async () => 0),
  };
  const retention = createConversationSessionRetention({
    openStorage: async () =>
      storage as unknown as Awaited<
        ReturnType<
          Parameters<
            typeof createConversationSessionRetention
          >[0]['openStorage']
        >
      >,
    createId: () => 'new-session',
    now: () => createdAt,
  });
  const write = jest
    .spyOn(dailyReminderIntentStore, 'write')
    .mockResolvedValue();
  expect(
    await createDailyReminderConversationOwner({ ...input, retention })(entry),
  ).toBe(1);
  expect(retention.activeLease(1)).toEqual({ id: 'new-session', version: 0 });
  expect(write).toHaveBeenCalledWith({
    active: true,
    entry: {
      ...entry,
      conversationOwner: { id: 'new-session', version: 0, createdAt },
    },
  });
  expect(storage.createSession).toHaveBeenCalledWith('new-session', 0);
});
