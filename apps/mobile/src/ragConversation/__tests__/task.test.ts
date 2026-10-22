import { ragConversationTask } from '../task';

test('lets multi-topic questions use bounded overview and short paragraphs instead of forcing one sentence', () => {
  const messages = ragConversationTask.createMessages({
    request: 'Explain my steps, sleep and measurements.',
    evidence: { items: [], coverage: [], conflicts: [] },
  });
  const user = messages[0];
  if (user?.role !== 'user' || typeof user.content !== 'string')
    throw new Error('Expected task input');
  const input = JSON.parse(user.content);
  expect(input.displayTimeZone).toBe(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  expect(input.answerRequirements).toContain(
    'short paragraphs for multiple requested topics',
  );
  expect(input.answerRequirements).not.toContain('Write one Korean sentence');
  expect(ragConversationTask.systemPrompt).toContain('view=health_overview');
  expect(ragConversationTask.systemPrompt).toContain(
    'steps, never occurrences',
  );
});

test('guides Korean literature questions to research before declaring missing sources unavailable', () => {
  const prompt = ragConversationTask.systemPrompt;
  expect(prompt).toContain('Write the user-facing answer in Korean');
  expect(prompt).toContain('Keep publication titles in their original form');
  expect(prompt).toContain('explicitly asks for literature');
  expect(prompt).toContain('request evidence before declaring it unavailable');
  expect(prompt).toContain(
    'denied, exhausted, or returned no supporting results',
  );
  // Prompt guidance cannot turn an unsupported generated answer into a valid result.
  expect(
    ragConversationTask.validateResult(
      { answer: '수면 관련 문헌을 확인했어요.' },
      {
        request:
          '성인의 수면 시간과 건강에 관한 공개 의학 문헌을 찾아 한국어로 요약해 주세요.',
        evidence: { items: [], coverage: [], conflicts: [] },
      },
    ).status,
  ).toBe('needs_clarification');
});

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

test.each(['scheduled', 'rescheduled', 'completed', 'cancelled'])(
  'preserves the appointment state %s separately from its date and title',
  status => {
    const effectiveTime =
      status === 'completed' ? '2025-01-03T09:00:00Z' : '2090-01-03T09:00:00Z';
    const content = `appointment: ${JSON.stringify({
      status,
      calendarEventSnapshot: { title: '복용 기록 상담' },
    })}`;
    const input = {
      request: '내가 먹는 약은?',
      evidence: {
        items: [{ ...reference, effectiveTime, content }],
        coverage: [],
        conflicts: [],
      },
    };
    const message = ragConversationTask.createMessages(input)[0];
    if (message.role !== 'user' || typeof message.content !== 'string')
      throw new Error('Expected user text');
    const body = JSON.parse(message.content);
    expect(body.evidence[0]).toMatchObject({
      content,
      effectiveTime,
      eventState: status,
    });
    // A calendar title alone never establishes that its consultation happened.
    expect(body.temporalRequirements).toContain('scheduled');
    expect(body.temporalRequirements).toContain('completed');
    expect(body.temporalRequirements).toContain('ongoing or completed care');
  },
);

test('keeps evidence content and coverage while leaving full citation identity for local validation', () => {
  const content =
    'Title: Synthetic publication\nAbstract: Unabridged supplied abstract.';
  const input = {
    request: 'Summarize this literature.',
    evidence: {
      items: [
        {
          ...reference,
          sourceKind: 'external_medical' as const,
          content,
          locator: {
            title: 'duplicate-title',
            originalUrl: 'https://example.org/paper',
            retrievedAt: 'private-validation-revision',
          },
        },
      ],
      coverage: [
        {
          sourceKind: 'external_medical' as const,
          searchedSourceIds: ['europe-pmc'],
          gaps: ['abstract gap'],
          truncated: true,
          returnedCount: 1,
          resultLimit: 5,
        },
      ],
      conflicts: [],
    },
  };
  const message = ragConversationTask.createMessages(input)[0];
  if (message.role !== 'user' || typeof message.content !== 'string')
    throw new Error('Expected user text');
  const body = JSON.parse(message.content);
  expect(body.evidence).toEqual([
    {
      evidenceId: 'evidence-1',
      sourceKind: 'external_medical',
      effectiveTime: null,
      reviewState: 'reviewed',
      content,
    },
  ]);
  expect(body.coverage).toEqual(input.evidence.coverage);
  expect(message.content).not.toContain('private-validation-revision');
  expect(ragConversationTask.systemPrompt).toContain(
    'one short Korean sentence',
  );
});
