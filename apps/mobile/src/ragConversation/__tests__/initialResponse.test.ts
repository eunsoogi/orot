import {
  initialConversationResponse,
  validateInitialConversationResponse,
} from '../initialResponse';
import { applyWorkflowStreamEvent } from '../../agent/workflowActivity';
import { createEmptyConversation } from '../conversationEmptySession';
import { createConversationTurnActivity } from '../conversationTurnActivity';
import type { ConversationSession } from '../conversationSessionTypes';
import { conversationHistoryActivity } from '../conversationHistoryActivity';

/** Initial acknowledgments are never evidence, saved partial answers, or duplicate turns. */
test('admits exact non-clinical copy and keeps it out of answer projection', () => {
  expect(validateInitialConversationResponse(initialConversationResponse)).toBe(
    initialConversationResponse,
  );
  expect(
    validateInitialConversationResponse(
      `${initialConversationResponse} 병이 확실해요.`,
    ),
  ).toBeUndefined();
  expect(validateInitialConversationResponse('')).toBeUndefined();
  expect(
    applyWorkflowStreamEvent('validated draft', {
      type: 'initial_response',
      callId: 'first',
      text: initialConversationResponse,
    }),
  ).toBe('validated draft');
});

test('shows one early reply for the current request without making it answer text', () => {
  let session: ConversationSession = {
    ...createEmptyConversation(1),
    busy: true,
    pendingMessage: { id: 2, content: '', activity: '' },
  };
  let current = true;
  const turn = createConversationTurnActivity({
    id: 1,
    responseId: 2,
    find: () => session,
    current: () => current,
    update: (_id, change) => {
      session = { ...session, ...change };
    },
  });
  const event = {
    type: 'initial_response' as const,
    callId: 'first',
    text: initialConversationResponse,
  };
  turn.observer.onTaskStreamEvent(event);
  turn.observer.onTaskStreamEvent({
    ...event,
    callId: 'duplicate',
    text: 'not another reply',
  });
  expect(session.pendingMessage?.initialResponse).toEqual({
    callId: 'first',
    text: initialConversationResponse,
  });
  expect(session.pendingMessage?.content).toBe('');
  expect(session.messages).toEqual([]);
  expect(
    conversationHistoryActivity(
      [],
      session.pendingMessage,
      undefined,
      undefined,
    ).visibleMessages,
  ).toHaveLength(1);
  turn.observer.onTaskStreamEvent({ type: 'started' });
  expect(session.pendingMessage?.initialResponse?.callId).toBe('first');
  current = false;
  session = {
    ...session,
    pendingMessage: { id: 3, content: '', activity: '' },
  };
  turn.observer.onTaskStreamEvent(event);
  expect(session.pendingMessage?.initialResponse).toBeUndefined();
});

test('possibility flow admits only the non-clinical initial event, not medical draft tokens', () => {
  const { bufferPossibilityStream } = require('../possibilityStreamBoundary');
  const observer = jest.fn();
  const guarded = bufferPossibilityStream('possibilities', {
    onTaskStreamEvent: observer,
  });
  const initial = {
    type: 'initial_response',
    callId: 'first',
    text: initialConversationResponse,
  };
  guarded.onTaskStreamEvent(initial);
  guarded.onTaskStreamEvent({ type: 'started' });
  guarded.onTaskStreamEvent({
    type: 'text_delta',
    text: 'unvalidated clinical claim',
  });
  guarded.onTaskStreamEvent({
    type: 'text_snapshot',
    text: 'unvalidated replacement',
  });
  expect(observer.mock.calls).toEqual([[initial]]);
});

test('request start publishes only a local receipt and rejects a duplicate busy submission', () => {
  const { prepareConversationRequest } = require('../conversationRequestStart');
  let id = 0;
  const session = {
    ...createEmptyConversation(1),
    draft: 'synthetic question',
  };
  const started = prepareConversationRequest(session, () => ++id);
  expect(started.change.pendingMessage.initialResponse.source).toBe('receipt');
  expect(started.change.pendingMessage.content).toBe('');
  expect(started.change.messages).toHaveLength(1);
  expect(
    prepareConversationRequest({ ...session, ...started.change }, () => ++id),
  ).toBeNull();
});

test('supplies localized early copy as task data while keeping system instructions English', () => {
  const { ragConversationTask } = require('../task');
  const [message] = ragConversationTask.createMessages({
    request: 'synthetic',
    evidence: { items: [], coverage: [], conflicts: [] },
  });
  expect(JSON.parse(message.content).initialResponseText).toBe(
    initialConversationResponse,
  );
  expect(ragConversationTask.systemPrompt).not.toMatch(/[\uAC00-\uD7A3]/u);
  expect(ragConversationTask.systemPrompt).toContain('initialResponseText');
});
