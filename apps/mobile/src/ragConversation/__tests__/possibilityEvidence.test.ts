import { ragConversationTask } from '../task';

test('provides synthetic supporting and contrary records with the limits for a possibility question', () => {
  const reference = {
    sourceKind: 'personal_record' as const,
    sourceId: 'synthetic-record',
    sourceRevision: '1',
    evidenceRevision: '1',
    locator: {
      kind: 'structured_record' as const,
      recordId: 'synthetic-record',
    },
    effectiveTime: null,
    reviewState: 'reviewed' as const,
  };
  const input = {
    request: '피로의 가능한 원인을 설명해 주세요.',
    evidence: {
      items: [
        { ...reference, evidenceId: 'symptom', content: '피로를 보고함' },
        {
          ...reference,
          evidenceId: 'contrary',
          content: '최근 발열은 없다고 보고함',
        },
        { ...reference, evidenceId: 'medication', content: '약 등록 기록' },
      ],
      coverage: [],
      conflicts: [],
    },
  };
  const message = ragConversationTask.createMessages(input)[0];
  if (message.role !== 'user' || typeof message.content !== 'string')
    throw new Error('Expected a user message');
  const body = JSON.parse(message.content);
  expect(body.evidence).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        evidenceId: 'symptom',
        content: '피로를 보고함',
      }),
      expect.objectContaining({
        evidenceId: 'contrary',
        content: '최근 발열은 없다고 보고함',
      }),
      expect.objectContaining({
        evidenceId: 'medication',
        content: '약 등록 기록',
      }),
    ]),
  );
  expect(ragConversationTask.systemPrompt).toContain(
    'supporting and contradictory evidence',
  );
  expect(ragConversationTask.systemPrompt).toContain(
    'registered medication alone does not establish',
  );
  expect(ragConversationTask.systemPrompt).toContain(
    'instead of a blanket refusal',
  );
  expect(ragConversationTask.systemPrompt).toContain('unsupported probability');
});

test('rejects a definite diagnosis from medication evidence while allowing a tentative explanation', () => {
  const input = {
    request: '피로의 가능한 원인은 무엇인가요?',
    evidence: {
      items: [
        {
          sourceKind: 'personal_record' as const,
          sourceId: 'medication',
          sourceRevision: '1',
          evidenceId: 'medication',
          evidenceRevision: '1',
          locator: {
            kind: 'structured_record' as const,
            recordId: 'medication',
          },
          effectiveTime: null,
          reviewState: 'reviewed' as const,
          content: '약 등록 기록',
        },
      ],
      coverage: [],
      conflicts: [],
    },
  };
  const unsafe = '현재 기록상 당뇨로 진단되었습니다.';
  expect(
    ragConversationTask.validateResult({ answer: unsafe }, input).status,
  ).toBe('invalid');
  expect(
    ragConversationTask.projectStreamedText?.(
      JSON.stringify({ value: { answerKind: 'grounded', answer: unsafe } }),
      input,
    ),
  ).toBeUndefined();
  expect(
    ragConversationTask.projectStreamedText?.(
      '{"value":{"answerKind":"grounded","answer":"현재 기록상 당뇨로 진단되었습니다.',
      input,
    ),
  ).toBeUndefined();
  const tentative =
    '피로에는 여러 원인이 있을 수 있어요. 약 등록만으로 원인을 알 수 없어 증상의 시기와 다른 기록을 확인해야 해요.';
  expect(
    ragConversationTask.validateResult({ answer: tentative }, input).status,
  ).toBe('valid');
  expect(
    ragConversationTask.projectStreamedText?.(
      JSON.stringify({ value: { answerKind: 'grounded', answer: tentative } }),
      input,
    ),
  ).toBe(tentative);
});

test('permits verbatim attributed diagnosis history but not an additional diagnosis', () => {
  const input = {
    request: '진료 기록에는 무엇이 적혀 있나요?',
    evidence: {
      items: [
        {
          sourceKind: 'personal_record' as const,
          sourceId: 'history',
          sourceRevision: '1',
          evidenceId: 'history',
          evidenceRevision: '1',
          locator: { kind: 'structured_record' as const, recordId: 'history' },
          effectiveTime: null,
          reviewState: 'reviewed' as const,
          content: 'manual_history: {"note":"당뇨로 진단받았어요"}',
        },
      ],
      coverage: [],
      conflicts: [],
    },
  };
  const history = '지난 진료 기록에는 당뇨로 진단받았다고 적혀 있어요.';
  expect(
    ragConversationTask.validateResult({ answer: history }, input).status,
  ).toBe('valid');
  expect(
    ragConversationTask.validateResult(
      { answer: '진료 기록에는 당뇨를 진단받았다고 적혀 있어요.' },
      input,
    ).status,
  ).toBe('valid');
  expect(
    ragConversationTask.validateResult(
      { answer: `${history} 현재 당뇨로 진단되었습니다.` },
      input,
    ).status,
  ).toBe('invalid');
});
