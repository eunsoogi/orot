import { validateInitialConversationResponse } from '../initialResponse';
const initialConversationResponse = '말씀하신 흐름을 살펴보고 이어서 답할게요.';
import { applyWorkflowStreamEvent } from '../../agent/workflowActivity';
import { createEmptyConversation } from '../conversationEmptySession';
import { createConversationTurnActivity } from '../conversationTurnActivity';
import type { ConversationSession } from '../conversationSessionTypes';
import { conversationHistoryActivity } from '../conversationHistoryActivity';

/** Initial acknowledgments are never evidence, saved partial answers, or duplicate turns. */
test('admits bounded contextual candidates and keeps them out of answer projection', () => {
  expect(validateInitialConversationResponse(initialConversationResponse)).toBe(
    initialConversationResponse,
  );
  expect(
    validateInitialConversationResponse(
      `${initialConversationResponse} 진단받았어요.`,
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

test('request start publishes loading without fabricated AI copy and rejects busy submission', () => {
  const { prepareConversationRequest } = require('../conversationRequestStart');
  let id = 0;
  const session = {
    ...createEmptyConversation(1),
    draft: 'synthetic question',
  };
  const started = prepareConversationRequest(session, () => ++id);
  expect(started.change.pendingMessage.initialResponse).toBeUndefined();
  expect(started.change.pendingMessage.content).toBe('');
  expect(started.change.messages).toHaveLength(1);
  expect(
    prepareConversationRequest({ ...session, ...started.change }, () => ++id),
  ).toBeNull();
});

test('keeps opening prose in the live boundary instead of repeating it during tools', () => {
  const { ragConversationTask } = require('../task');
  const [message] = ragConversationTask.createMessages({
    request: 'synthetic',
    evidence: { items: [], coverage: [], conflicts: [] },
  });
  expect(JSON.parse(message.content).initialResponseText).toBeUndefined();
  expect(ragConversationTask.initialToolResponse).toBeUndefined();
  expect(ragConversationTask.reviewInitialToolResponse).toBeUndefined();
  expect(ragConversationTask.taskVersion).toBe('14');
  expect(
    validateInitialConversationResponse('어떤 흐름인지 함께 살펴볼게요.'),
  ).toBe('어떤 흐름인지 함께 살펴볼게요.');
  expect(ragConversationTask.systemPrompt).not.toMatch(/[\uAC00-\uD7A3]/u);
  expect(ragConversationTask.systemPrompt).not.toContain('first reply');
});

// These are deterministic contract checks, not real-model semantic-quality evidence.
test.each([
  '괜찮으니 기다리세요.',
  '걱정 마세요.',
  '안심하고 기다리셔도 돼요.',
  '문제 없어요.',
])('suppresses reassurance before any semantic reviewer: %s', text => {
  expect(validateInitialConversationResponse(text)).toBeUndefined();
});
test.each([
  '가슴 통증이 심해요',
  '숨 못 쉬겠어',
  '응급인지 봐줘',
  'chest pain now',
])(
  'does not add preview review latency for recognizable urgent input: %s',
  request => {
    expect(
      validateInitialConversationResponse(
        '말씀하신 흐름을 살펴볼게요.',
        request,
      ),
    ).toBeUndefined();
  },
);
