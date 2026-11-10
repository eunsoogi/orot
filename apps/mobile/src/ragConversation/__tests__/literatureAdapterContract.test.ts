import { createEuropePmcEvidenceSearchTool } from '@orot/agent-runtime';
import { createEuropePmcMedicalEvidenceService } from '../../externalMedicalEvidence/europePmc';
import { ragConversationTask } from '../task';

test('validates exact source spans from the real Europe PMC adapter output', async () => {
  const abstract =
    '<h4>Methods</h4>We included adults in this synthetic review.<h4>Results</h4>Short sleep was associated with obesity (pooled OR 1.40, 95% CI 1.27-1.55; I<sup>2</sup> = 83.7%).<h4>Conclusions</h4>The certainty was limited.';
  const service = createEuropePmcMedicalEvidenceService({
    now: () => new Date('2026-11-06T04:27:21.901Z'),
    fetcher: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        resultList: {
          result: [
            {
              id: '123',
              source: 'MED',
              title: 'Synthetic study',
              abstractText: abstract,
              dateOfRevision: '2026-10-29',
            },
          ],
        },
      }),
    }),
  });
  const tool = createEuropePmcEvidenceSearchTool({
    service,
    consent: { authorize: async () => 'authorized' },
  });
  const batch = await tool.search({
    operationRunId: 'adapter-contract',
    operationKey: 'call',
    input: { query: 'sleep' },
    allowedScope: { sourceKinds: ['external_medical'] },
    resultLimit: 1,
    maxPayloadBytes: 65536,
    signal: new AbortController().signal,
  });
  if (!('items' in batch)) throw new Error('Expected evidence');
  const item = batch.items[0]!;
  const entry = {
    evidenceId: item.evidenceId,
    sourceRevision: item.sourceRevision,
    evidenceRevision: item.evidenceRevision,
    populationSpan: 'We included adults in this synthetic review.',
    resultSpan:
      'Short sleep was associated with obesity (pooled OR 1.40, 95% CI 1.27-1.55; I<sup>2</sup> = 83.7%).',
    statisticSpan: 'pooled OR 1.40, 95% CI 1.27-1.55',
    limitationSpan: 'The certainty was limited.',
    measure: 'odds_ratio',
    value: '1.40',
    confidenceInterval: '1.27-1.55',
  };
  const output = ragConversationTask.validateResult(
    { answerKind: 'grounded', answer: '', literature: [entry] },
    { request: 'Explain', evidence: batch },
  );
  expect(output.status).toBe('valid');
  if (output.status === 'valid') {
    expect(output.value.answer).toContain('오즈비 1.40');
    expect(output.value.answer).toContain('I<sup>2</sup> = 83.7%');
    expect(output.value.literatureReferences).toEqual([
      expect.objectContaining({
        evidenceId: 'MED:123',
        evidenceRevision: 'updated:2026-10-29',
      }),
    ]);
  }
});
