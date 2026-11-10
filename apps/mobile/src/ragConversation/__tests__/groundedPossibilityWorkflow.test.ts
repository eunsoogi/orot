import { runRagConversationTurn } from '../service';
import { fixture, response } from '../testSupport/conversationEnvelopeFixtures';

// The runtime and citation validator are real; only the synthetic local store is stubbed.
jest.mock('../../storage/secureDatabase', () => ({
  openLocalStorage: async () => ({
    listDeletedSourceReferenceIds: async () => [],
    get: async () => null,
    hasStoredRecordId: async (id: string) => id === 'record-1',
  }),
}));

const record = {
  sourceKind: 'personal_record' as const,
  sourceId: 'record',
  sourceRevision: 'r1',
  evidenceId: 'record-1',
  evidenceRevision: 'e1',
  locator: { kind: 'structured_record', recordId: 'record-1' },
  effectiveTime: null,
  reviewState: 'reviewed' as const,
  content: '지난주부터 피로를 보고했어요.',
};

function setup(answer: string, citation: string) {
  const f = fixture();
  f.generate.mockReset().mockResolvedValue(
    response({
      type: 'result',
      value: { answerKind: 'grounded', answer },
      citations: [citation],
    }),
  );
  return {
    ...f.options,
    question: '피로의 가능한 원인을 알려 주세요.',
    entryIntent: 'possibilities' as const,
    publicEvidence: {
      items: [record],
      coverage: [
        {
          sourceKind: 'personal_record' as const,
          searchedSourceIds: ['record'],
          gaps: [],
          truncated: false,
          resultLimit: 1,
          returnedCount: 1,
        },
      ],
      conflicts: [],
    },
    loadCurrentEvidence: async () => ({
      batch: { items: [], coverage: [], conflicts: [] },
      chunks: [],
    }),
    workflow: {
      ...f.options.workflow,
      execution: {
        ...f.options.workflow.execution,
        allowedScope: { sourceKinds: ['personal_record' as const] },
      },
    },
  };
}

test('returns a tentative possibility with its matching record citation', async () => {
  const result = await runRagConversationTurn(
    setup(
      '피로에는 여러 원인이 있을 수 있어요. 더 확인이 필요해요.',
      'record-1',
    ),
  );
  expect(result).toMatchObject({
    status: 'answer',
    answer: expect.stringContaining('여러 원인이 있을 수'),
    citations: [
      expect.objectContaining({
        evidenceId: 'record-1',
        evidenceRevision: 'e1',
      }),
    ],
  });
});

test.each([
  ['unmatched citation', '피로의 원인은 더 확인해야 해요.', 'missing'],
  ['numeric probability', '당뇨일 확률은 70%입니다.', 'record-1'],
  ['medication instruction', '약물 용량을 늘리세요.', 'record-1'],
])(
  'does not publish %s from a synthetic model',
  async (_label, answer, citation) => {
    const events: unknown[] = [];
    const result = await runRagConversationTurn(setup(answer, citation), {
      onTaskStreamEvent: event => events.push(event),
    });
    expect(result.status).not.toBe('answer');
    expect(JSON.stringify(events)).not.toContain(answer);
  },
);
