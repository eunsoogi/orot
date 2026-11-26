import { createConversationScreenSources } from '../conversationScreenSources';
import type { ConversationSessions } from '../conversationSessions';
import { conversationToolEventFixtures } from '../testSupport/conversationToolEventFixtures';

const event = conversationToolEventFixtures[0]!;
const source = event.sources[0]!;
const scope = {
  durableMessageId: 'turn',
  sessionId: 'session',
  operationRunId: event.operationRunId,
  callId: event.callId,
};
const verified = {
  ...source,
  reviewState: 'unknown' as const,
  effectiveTime: '2026-01-01',
  locator: { title: 'Synthetic local source' },
};

function setup() {
  const row = { toolMessageId: scope.durableMessageId, toolEvents: [event] };
  const session = { id: 1, messages: [row], pendingMessage: null };
  const store = {
    getSnapshot: jest.fn(() => ({ sessions: [session] })),
    ownsActiveSession: jest.fn(() => true),
    savedReportLease: jest.fn(() => ({ id: scope.sessionId, version: 3 })),
    subscribe: jest.fn((_listener: () => void) => () => {}),
    toolSourceSessionId: jest.fn(() => scope.sessionId),
  };
  const next = jest.fn(async () => verified);
  const open = createConversationScreenSources(
    store as unknown as ConversationSessions,
    1,
    jest.fn(),
    next,
  ).resolveToolSource!;
  return { open, next, store };
}

test('an exact current personal event reaches the existing durable resolver once', async () => {
  const { open, next } = setup();
  const { signal } = new AbortController();
  expect(await open(source, signal, scope)).toBe(verified);
  expect(next).toHaveBeenCalledTimes(1);
  expect(next).toHaveBeenCalledWith(source, expect.any(AbortSignal), scope);
});

test.each([
  'durableMessageId',
  'sessionId',
  'operationRunId',
  'callId',
] as const)('wrong %s never reaches the alias reader', async field => {
  const { open, next } = setup();
  const { signal } = new AbortController();
  expect(
    await open(source, signal, { ...scope, [field]: 'other' }),
  ).toBeUndefined();
  expect(next).not.toHaveBeenCalled();
});

test('changed evidence revision never reaches the alias reader', async () => {
  const { open, next } = setup();
  const { signal } = new AbortController();
  expect(
    await open({ ...source, evidenceRevision: 'another' }, signal, scope),
  ).toBeUndefined();
  expect(next).not.toHaveBeenCalled();
});

test('a held valid result cannot publish after the same durable session changes lease version', async () => {
  const { open, next, store } = setup();
  const { signal } = new AbortController();
  const held = open(source, signal, scope);
  expect(next).toHaveBeenCalledTimes(1);
  store.savedReportLease.mockReturnValue({ id: scope.sessionId, version: 4 });
  expect(await held).toBeUndefined();
});

test('switching away and back does not revive an in-flight tap', async () => {
  const { open, store } = setup();
  const { signal } = new AbortController();
  const held = open(source, signal, scope);
  store.ownsActiveSession.mockReturnValue(false);
  store.subscribe.mock.calls[0]![0]();
  store.ownsActiveSession.mockReturnValue(true);
  expect(await held).toBeUndefined();
});
