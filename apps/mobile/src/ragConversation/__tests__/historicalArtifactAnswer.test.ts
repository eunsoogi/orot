import { runRagConversationTurn } from '../service';
import { fixture, response } from '../testSupport/conversationEnvelopeFixtures';

function generatedFixture(answerKind: 'grounded' | 'prior_output') {
  const f = fixture();
  f.generate.mockReset().mockResolvedValueOnce(
    response({
      type: 'result',
      value: { answerKind, answer: '확인되지 않은 새로운 주장' },
      citations: ['synthetic-evidence'],
    }),
  );
  const original = f.options.loadCurrentEvidence;
  return {
    ...f,
    options: {
      ...f.options,
      loadCurrentEvidence: async (question: string, signal: AbortSignal) => {
        const data = await original(question, signal);
        return {
          ...data,
          batch: {
            ...data.batch,
            items: data.batch.items.map(item => ({
              ...item,
              sourceKind: 'generated_artifact' as const,
            })),
            coverage: data.batch.coverage.map(item => ({
              ...item,
              sourceKind: 'generated_artifact' as const,
            })),
          },
        };
      },
      workflow: {
        ...f.options.workflow,
        execution: {
          ...f.options.workflow.execution,
          allowedScope: { sourceKinds: ['generated_artifact' as const] },
        },
      },
      readHistoricalArtifact: async () => ({
        status: 'available' as const,
        document: {
          sourceKind: 'generated_artifact' as const,
          metadata: {
            type: 'symptom_summary',
            id: 'saved',
            originFeature: 'symptom_summary',
            originSession: null,
            createdAt: '2035-01-01T00:00:00Z',
            eventTime: null,
            revision: '1',
            providerId: 'provider',
            modelId: 'model',
            completion: 'complete' as const,
            review: 'unreviewed' as const,
          },
          sourceStatus: 'current' as const,
          analysis: {
            hypotheses: [
              {
                title: '이전 요약',
                summary: '저장된 이전 결과',
                uncertainty: '확인되지 않음',
                missingData: [],
                supportingEvidence: [],
                contraryEvidence: [],
              },
            ],
          },
        },
      }),
    },
  };
}

test('does not accept a clinical answer grounded only in an AI artifact', async () => {
  const f = generatedFixture('grounded');
  expect(await runRagConversationTurn(f.options)).toEqual({
    status: 'insufficient',
  });
});

test('returns only a revalidated source link rather than copied or model-written claims', async () => {
  const f = generatedFixture('prior_output');
  const result = await runRagConversationTurn(f.options);
  expect(result).toMatchObject({ status: 'answer' });
  if (result.status !== 'answer') throw new Error('Expected historical output');
  expect(result.answer).not.toContain('저장된 이전 결과');
  expect(result.answer).toContain('아래 출처');
  expect(result.citations).toHaveLength(1);
  expect(result.answer).not.toContain('확인되지 않은 새로운 주장');
});
