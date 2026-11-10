import { runRagConversationTurn } from '../service';
import { fixture, response } from '../testSupport/conversationEnvelopeFixtures';

const item = {
  sourceKind: 'external_medical' as const,
  sourceId: 'europe-pmc',
  sourceRevision: 'r1',
  evidenceId: 'MED:1',
  evidenceRevision: 'e1',
  locator: {},
  effectiveTime: null,
  reviewState: 'unknown' as const,
  content:
    'Abstract: Adults were studied. Short sleep was associated with obesity (OR 1.40, 95% CI 1.27-1.55).\nOriginal source: https://europepmc.org/article/MED/1',
};
const entry = {
  evidenceId: 'MED:1',
  sourceRevision: 'r1',
  evidenceRevision: 'e1',
  populationSpan: 'Adults were studied.',
  resultSpan:
    'Short sleep was associated with obesity (OR 1.40, 95% CI 1.27-1.55).',
  statisticSpan: 'OR 1.40, 95% CI 1.27-1.55',
  limitationSpan: '',
  measure: 'odds_ratio',
  value: '1.40',
  confidenceInterval: '1.27-1.55',
};

function options() {
  const f = fixture();
  return {
    ...f,
    options: {
      ...f.options,
      question: 'Explain this study',
      loadCurrentEvidence: async () => ({
        batch: { items: [], coverage: [], conflicts: [] },
        chunks: [],
      }),
      publicEvidence: {
        items: [item],
        coverage: [
          {
            sourceKind: 'external_medical' as const,
            searchedSourceIds: ['europe-pmc'],
            gaps: [],
            truncated: false,
            resultLimit: 1,
            returnedCount: 1,
          },
        ],
        conflicts: [],
      },
    },
  };
}

test('renders a verified paper and retains the matching citation', async () => {
  const f = options();
  f.generate.mockReset().mockResolvedValueOnce(
    response({
      type: 'result',
      value: {
        answerKind: 'grounded',
        answer: 'ignored',
        literature: [entry],
      },
      citations: ['MED:1'],
    }),
  );
  const result = await runRagConversationTurn(f.options);
  expect(result.status).toBe('answer');
  if (result.status === 'answer') {
    expect(result.completion).toBe('partial');
    expect(result.answer).toContain('관찰 결과인지 확인하지 못했어요');
    expect(result.answer).not.toContain('보고된 통계:');
    expect(result.answer).toContain('오즈비 1.40');
    expect(result.answer).not.toContain('ignored');
    expect(result.citations).toEqual([
      expect.objectContaining({ evidenceId: 'MED:1', evidenceRevision: 'e1' }),
    ]);
  }
});

test('does not publish or retain a result whose displayed paper was not cited', async () => {
  const f = options();
  const capture = jest.fn();
  f.generate.mockReset().mockResolvedValueOnce(
    response({
      type: 'result',
      value: {
        answerKind: 'grounded',
        answer: 'ignored',
        literature: [entry],
      },
      citations: [],
    }),
  );
  const result = await runRagConversationTurn({
    ...f.options,
    onValidatedEvidence: capture,
  });
  expect(result.status).not.toBe('answer');
  expect(capture).not.toHaveBeenCalled();
});

test('a proposed statistic is returned only as an unverified partial source quotation', async () => {
  const f = options();
  const proposed =
    'The proposed estimate (OR 1.40, 95% CI 1.27-1.55) was not observed.';
  f.generate.mockReset().mockResolvedValueOnce(
    response({
      type: 'result',
      value: {
        answerKind: 'grounded',
        answer: '',
        literature: [{ ...entry, resultSpan: proposed }],
      },
      citations: ['MED:1'],
    }),
  );
  const outcome = await runRagConversationTurn({
    ...f.options,
    publicEvidence: {
      ...f.options.publicEvidence,
      items: [
        {
          ...item,
          content: `Abstract: Adults were studied. ${proposed}\nOriginal source: https://europepmc.org/article/MED/1`,
        },
      ],
    },
  });
  expect(outcome.status).toBe('answer');
  if (outcome.status === 'answer') {
    expect(outcome.completion).toBe('partial');
    expect(outcome.answer).toContain('관찰 결과인지 확인하지 못했어요');
    expect(outcome.answer).not.toContain('보고된 통계:');
    expect(outcome.citations).toEqual([
      expect.objectContaining({ evidenceId: 'MED:1', evidenceRevision: 'e1' }),
    ]);
  }
});
