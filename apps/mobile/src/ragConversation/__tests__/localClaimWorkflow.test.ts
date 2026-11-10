import { runRagConversationTurn } from '../service';
import { fixture, response } from '../testSupport/conversationEnvelopeFixtures';

// The storage deletion boundary has separate coverage; this test exercises the live workflow contract.
jest.mock('../../aiFeatures/integration/deletionAwareEvidence', () => ({
  revalidateWithLocalDeletionGuard: async () => true,
}));

test.each([
  ['내 수면 기록을 알려줘', false],
  ['내 기록과 문헌을 알려줘', true],
])(
  'preserves the local answer and reports missing literature when requested: %s',
  async (question, missingLiterature) => {
    const f = fixture();
    const local = {
      sourceKind: 'personal_record' as const,
      sourceId: 'record',
      sourceRevision: 'r1',
      evidenceId: 'local',
      evidenceRevision: 'e1',
      locator: {},
      effectiveTime: null,
      reviewState: 'unknown' as const,
      content: '수면 기록은 7시간이에요.',
    };
    const paper = {
      ...local,
      sourceKind: 'external_medical' as const,
      sourceId: 'europe-pmc',
      evidenceId: 'paper',
      content: 'Abstract: A public study.',
    };
    const chunk = {
      id: 'local',
      text: local.content,
      metadata: { sourceId: local.sourceId, evidenceId: local.evidenceId },
    };
    f.generate.mockReset().mockResolvedValueOnce(
      response({
        type: 'result',
        value: {
          answerKind: 'grounded',
          answer: 'ignored',
          localClaims: [
            {
              sourceRevision: 'r1',
              evidenceId: 'local',
              evidenceRevision: 'e1',
              span: local.content,
            },
          ],
        },
        citations: ['local'],
      }),
    );
    const result = await runRagConversationTurn({
      ...f.options,
      question,
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
          allowedScope: {
            sourceKinds: ['personal_record', 'external_medical'],
          },
        },
      },
    });
    expect(result).toMatchObject({
      status: 'answer',
      answer: expect.stringContaining(local.content),
      citations: [expect.objectContaining({ evidenceId: 'local' })],
    });
    if (result.status === 'answer') {
      if (missingLiterature) {
        expect(result.completion).toBe('partial');
        expect(result.answer).toContain('문헌');
        expect(result.answer).toContain('비교');
        expect(result.answer).toContain('확인하지 못');
      } else {
        expect(result.completion).toBeUndefined();
      }
    }
  },
);
