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
