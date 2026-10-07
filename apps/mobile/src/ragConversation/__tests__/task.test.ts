import { ragConversationTask } from '../task';

const reference = {
  sourceKind: 'personal_record' as const,
  sourceId: 'record-1',
  sourceRevision: '1',
  evidenceId: 'evidence-1',
  evidenceRevision: '1',
  locator: { kind: 'structured_record', recordId: 'record-1' },
  effectiveTime: null,
  reviewState: 'reviewed' as const,
};

test('makes previous assistant claims context only and validates a current-evidence answer', () => {
  const input = {
    request: '지난달 혈압이 어땠나요?',
    context: [{ role: 'assistant', content: '예전 답변의 숫자' }],
    evidence: {
      items: [{ ...reference, content: '혈압 기록 120/80' }],
      coverage: [],
      conflicts: [],
    },
  } as const;
  const message = ragConversationTask.createMessages(input)[0];
  if (message.role !== 'user')
    throw new Error('The conversation task must create a user message.');
  expect(message.content).toContain('previousConversation');
  expect(message.content).toContain('예전 답변의 숫자');
  expect(ragConversationTask.systemPrompt).toMatch(
    /Previous conversation is context, not evidence/,
  );
  expect(
    ragConversationTask.validateResult(
      { answer: '현재 기록은 120/80이에요.' },
      input,
    ).status,
  ).toBe('valid');
});

test('asks for clarification when the current evidence set is empty', () => {
  const result = ragConversationTask.validateResult(
    { answer: '이전 답변으로 추정했어요.' },
    { request: '질문', evidence: { items: [], coverage: [], conflicts: [] } },
  );
  expect(result.status).toBe('needs_clarification');
});
