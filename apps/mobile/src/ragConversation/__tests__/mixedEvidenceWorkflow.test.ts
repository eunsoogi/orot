import { runRagConversationTurn } from '../service';
import { fixture, response } from '../testSupport/conversationEnvelopeFixtures';

// This isolates claim and citation wiring; native deletion storage is checked separately.
jest.mock('../../aiFeatures/integration/deletionAwareEvidence', () => ({
  revalidateWithLocalDeletionGuard: async () => true,
}));

const local = {
  sourceKind: 'personal_record' as const,
  sourceId: 'record',
  sourceRevision: 'r1',
  evidenceId: 'local',
  evidenceRevision: 'e1',
  locator: {},
  effectiveTime: null,
  reviewState: 'unknown' as const,
  content: '수면 시간은 7시간으로 기록되었어요.',
};
const paper = {
  sourceKind: 'external_medical' as const,
  sourceId: 'europe-pmc',
  sourceRevision: 'r2',
  evidenceId: 'MED:1',
  evidenceRevision: 'e2',
  locator: {},
  effectiveTime: null,
  reviewState: 'unknown' as const,
  content:
    'Abstract: Adults were studied. Sleep was associated with health.\nOriginal source: https://europepmc.org/article/MED/1',
};
const localClaim = {
  sourceRevision: 'r1',
  evidenceId: 'local',
  evidenceRevision: 'e1',
  span: local.content,
};
const paperClaim = {
  sourceRevision: 'r2',
  evidenceId: 'MED:1',
  evidenceRevision: 'e2',
  populationSpan: 'Adults were studied.',
  resultSpan: 'Sleep was associated with health.',
  statisticSpan: '',
  limitationSpan: '',
  measure: 'qualitative',
  value: '',
  confidenceInterval: '',
};

test('the actual workflow binds both source claims to their citations and preserves the comparison limit', async () => {
  const f = fixture();
  f.generate.mockReset().mockResolvedValueOnce(
    response({
      type: 'result',
      value: {
        answerKind: 'grounded',
        answer: 'ignored',
        localClaims: [localClaim],
        literature: [paperClaim],
      },
      citations: ['local', 'MED:1'],
    }),
  );
  const chunk = {
    id: 'local',
    text: local.content,
    metadata: { sourceId: local.sourceId, evidenceId: local.evidenceId },
  };
  const result = await runRagConversationTurn({
    ...f.options,
    question: '기록과 문헌을 비교해 주세요',
    loadCurrentEvidence: async () => ({
      batch: {
        items: [local],
        coverage: [
          {
            sourceKind: 'personal_record',
            searchedSourceIds: ['record'],
            gaps: [],
            truncated: false,
            resultLimit: 1,
            returnedCount: 1,
          },
        ],
        conflicts: [],
      },
      chunks: [chunk as never],
    }),
    rag: { search: async () => [{ chunk, score: 1 }] as never },
    publicEvidence: {
      items: [paper],
      coverage: [
        {
          sourceKind: 'external_medical',
          searchedSourceIds: ['europe-pmc'],
          gaps: [],
          truncated: false,
          resultLimit: 1,
          returnedCount: 1,
        },
      ],
      conflicts: [],
    },
    workflow: {
      ...f.options.workflow,
      execution: {
        ...f.options.workflow.execution,
        allowedScope: { sourceKinds: ['personal_record', 'external_medical'] },
      },
    },
  });
  expect(result.status).toBe('answer');
  if (result.status === 'answer') {
    expect(result.completion).toBe('partial');
    expect(result.answer).toContain(local.content);
    expect(result.answer).toContain('직접적인 비교는 확인하지 못했어요');
    expect(result.citations.map(item => item.evidenceId)).toEqual([
      'local',
      'MED:1',
    ]);
  }
});

test.each(['문헌을 설명해 주세요', '수면과 비만 관련 연구는 어떤가요?'])(
  'a factual literature claim cannot evade source validation for %s',
  async question => {
    const f = fixture();
    f.generate.mockReset().mockResolvedValueOnce(
      response({
        type: 'result',
        value: { answerKind: 'conversation', answer: '비만 위험도 40% 증가' },
        citations: [],
      }),
    );
    const result = await runRagConversationTurn({
      ...f.options,
      question,
      loadCurrentEvidence: async () => ({
        batch: { items: [], coverage: [], conflicts: [] },
        chunks: [],
      }),
      publicEvidence: {
        items: [paper],
        coverage: [
          {
            sourceKind: 'external_medical',
            searchedSourceIds: ['europe-pmc'],
            gaps: [],
            truncated: false,
            resultLimit: 1,
            returnedCount: 1,
          },
        ],
        conflicts: [],
      },
    });
    expect(result.status).not.toBe('answer');
  },
);

test('a greeting remains conversational even when unrelated literature exists', async () => {
  const f = fixture();
  f.generate.mockReset().mockResolvedValueOnce(
    response({
      type: 'result',
      value: { answerKind: 'conversation', answer: '천만에요!' },
      citations: [],
    }),
  );
  const result = await runRagConversationTurn({
    ...f.options,
    question: '고마워요',
    loadCurrentEvidence: async () => ({
      batch: { items: [], coverage: [], conflicts: [] },
      chunks: [],
    }),
    publicEvidence: {
      items: [paper],
      coverage: [
        {
          sourceKind: 'external_medical',
          searchedSourceIds: ['europe-pmc'],
          gaps: [],
          truncated: false,
          resultLimit: 1,
          returnedCount: 1,
        },
      ],
      conflicts: [],
    },
  });
  expect(result).toMatchObject({ status: 'answer', answer: '천만에요!' });
});
