import type { JsonValue } from '@orot/model-runtime';
import { conversationRequestHistory } from '../conversationRequestHistory';
import { conversationWorkflowContext } from '../conversationWorkflowContext';
import { ragConversationTask } from '../task';
import { fixture } from '../testSupport/conversationEnvelopeFixtures';
import { jsonByteLength } from '../../aiFeatures/integration/evidenceUtils';

function payload(context: JsonValue) {
  const message = ragConversationTask.createMessages({
    request: 'synthetic current question',
    context,
    evidence: { items: [], coverage: [], conflicts: [] },
  })[0];
  if (message.role !== 'user' || typeof message.content !== 'string')
    throw new Error('Expected user JSON');
  return JSON.parse(message.content);
}

test('assembled task retains each question once and resolves the original ordered pairs', () => {
  const turns = Array.from({ length: 4 }, (_, n) => ({
    question: `synthetic-${n}-` + '가'.repeat(300),
    answer: `validated answer ${n}`,
  }));
  const context = conversationWorkflowContext({
    ...fixture().options,
    previousMessages: turns.flatMap(turn => [
      { role: 'user' as const, content: turn.question },
      { role: 'assistant' as const, content: 'unvalidated old answer' },
    ]),
    validatedPriorTurns: turns,
  });
  const before = JSON.stringify(context);
  const body = payload(context);
  const restored = body.priorDialogue.map(
    (turn: { questionFromPreviousConversation: number; answer: string }) => ({
      question:
        body.previousConversation[turn.questionFromPreviousConversation]
          .content,
      answer: turn.answer,
    }),
  );
  expect(restored).toEqual(turns);
  for (const turn of turns) {
    expect(JSON.stringify(body).split(turn.question)).toHaveLength(2);
  }
  expect(
    body.previousConversation.map((message: { role: string }) => message.role),
  ).toEqual([
    'user',
    'assistant',
    'user',
    'assistant',
    'user',
    'assistant',
    'user',
    'assistant',
  ]);
  expect(JSON.stringify(body)).not.toContain('unvalidated old answer');
  expect(body.priorDialogueQuestionReferences).toContain('not turn identity');
  expect(body.priorDialogueQuestionReferences).toContain(
    'cite only current evidence',
  );
  expect(JSON.stringify(context)).toBe(before);
  const legacy = { ...body, priorDialogue: turns };
  delete legacy.priorDialogueQuestionReferences;
  expect(jsonByteLength(legacy) - jsonByteLength(body)).toBeGreaterThan(3000);
});

test('does not alias prefix, normalized, assistant-only, or omitted history matches', () => {
  const context = {
    history: [
      { role: 'user', content: 'q'.repeat(1500) },
      { role: 'user', content: 'different ' },
      { role: 'assistant', content: 'assistant-only' },
    ],
    priorDialogue: [
      { question: 'q'.repeat(1000), answer: 'prefix' },
      { question: 'different', answer: 'whitespace' },
      { question: 'assistant-only', answer: 'not user' },
      { question: 'absent', answer: 'not in history' },
    ],
  };
  const body = conversationRequestHistory(context);
  expect(body.priorDialogue).toEqual(context.priorDialogue);
  expect(body.previousConversation).toEqual(context.history);
  expect(body).not.toHaveProperty('priorDialogueQuestionReferences');
});

test('equal text never collapses separate turns or promotes ordinary history to validated dialogue', () => {
  const history = [
    { role: 'user', content: 'repeated question' },
    { role: 'assistant', content: 'ordinary placeholder' },
    { role: 'user', content: 'repeated question' },
  ];
  const turns = [
    { question: 'repeated question', answer: 'first answer' },
    { question: 'repeated question', answer: 'second answer' },
  ];
  const body = conversationRequestHistory({ history, priorDialogue: turns });
  expect(body.previousConversation).toEqual(history);
  expect(body.priorDialogue).toEqual([
    { questionFromPreviousConversation: 0, answer: 'first answer' },
    { questionFromPreviousConversation: 0, answer: 'second answer' },
  ]);
  // Deleted/revoked dialogue must stay absent: the request projection cannot
  // reconstruct answers from a matching ordinary-history question.
  const omitted = payload({ history, priorDialogueOmitted: true });
  expect(omitted.priorDialogue).toEqual([]);
  expect(omitted.priorDialogueOmitted).toBe(true);
  expect(omitted).not.toHaveProperty('priorDialogueQuestionReferences');
});

test('indexes the complete request without dropping earlier turns', () => {
  const history = Array.from({ length: 10 }, (_, n) => ({
    role: 'user',
    content: `q${n}`,
  }));
  const body = conversationRequestHistory({
    history,
    priorDialogue: [
      { question: 'q0', answer: 'earliest answer' },
      { question: 'q9', answer: 'latest answer' },
    ],
  });
  expect(body.previousConversation).toEqual(history);
  expect(body.priorDialogue).toEqual([
    { questionFromPreviousConversation: 0, answer: 'earliest answer' },
    { questionFromPreviousConversation: 9, answer: 'latest answer' },
  ]);
});
