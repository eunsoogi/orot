import type { ConversationToolEvent } from '@orot/agent-runtime';
import { createEmptyConversation } from '../conversationEmptySession';
import { createConversationTurnActivity } from '../conversationTurnActivity';
import type { ConversationSession } from '../conversationSessionTypes';

const event: ConversationToolEvent = {
  version: 1,
  operationRunId: 'synthetic-tool-run',
  callId: 'synthetic-tool',
  toolName: 'record-search',
  order: 0,
  status: 'started',
  inputSummary: { sourceKind: 'personal_record' },
  sources: [],
};

test('accepted tool events do a single settled-history membership pass for one immutable history', () => {
  let inspections = 0;
  const rows = Array.from({ length: 256 }, (_, index) =>
    Object.freeze({
      id: index + 1,
      role: 'assistant' as const,
      content: 'synthetic history',
      get toolMessageId() {
        inspections++;
        return 'prior-' + index;
      },
    }),
  );
  let session: ConversationSession = {
    ...createEmptyConversation(1),
    messages: rows,
    busy: true,
    pendingMessage: { id: 500, content: '', activity: '' },
  };
  const turn = createConversationTurnActivity({
    id: 1,
    responseId: 500,
    find: () => session,
    update: (_id, change) => {
      session = { ...session, ...change };
    },
    current: () => true,
  });
  for (let order = 0; order < 32; order++) {
    const tool = { ...event, order, callId: 'call-' + order };
    turn.observer.onToolEvent(tool);
    turn.observer.onToolEvent({ ...tool, status: 'completed' });
    turn.observer.onTaskStreamEvent({ type: 'text_delta', text: 'x' });
  }
  expect(inspections).toBeLessThanOrEqual(rows.length);
  expect(session.messages).toBe(rows);
  expect(session.pendingMessage?.toolEvents).toHaveLength(32);
  expect(
    session.pendingMessage?.toolEvents?.every(
      tool => tool.status === 'completed',
    ),
  ).toBe(true);
  expect(session.pendingMessage?.content).toBe('x'.repeat(32));
});

test('a newly settled matching row receives terminal metadata without changing its neighbors', () => {
  const unrelated = { id: 2, role: 'assistant' as const, content: 'prior' };
  let session: ConversationSession = {
    ...createEmptyConversation(1),
    messages: [unrelated],
    busy: true,
    pendingMessage: { id: 4, content: '', activity: '' },
  };
  const turn = createConversationTurnActivity({
    id: 1,
    responseId: 4,
    find: () => session,
    update: (_id, change) => {
      session = { ...session, ...change };
    },
    current: () => true,
  });
  turn.observer.onToolEvent(event);
  const settled = {
    id: 4,
    role: 'assistant' as const,
    content: 'partial',
    toolMessageId: 'response-4',
  };
  session = {
    ...session,
    messages: [unrelated, settled],
    pendingMessage: null,
  };
  turn.finish('cancelled');
  expect(session.messages[0]).toBe(unrelated);
  expect(session.messages[1]?.toolEvents?.map(tool => tool.status)).toEqual([
    'cancelled',
  ]);
  expect(session.messages[1]?.content).toBe('partial');
});
