import type { runDiseaseHypothesisAnalysis } from '../../../diseaseHypotheses/task';
import { workflowFixture } from '../testSupport/publicWebWorkflowFixture';

test('disease analysis executes the public lookup before its model workflow', async () => {
  const runner = jest.fn(
    async (options: Parameters<typeof runDiseaseHypothesisAnalysis>[0]) => {
      expect(options.initialEvidence.items[0]?.sourceId).toBe('public-web');
      return {
        status: 'incomplete_inventory' as const,
        reason: 'unavailable' as const,
      };
    },
  );
  const run = workflowFixture(true, runner);
  await run.services.generateDiseaseHypotheses();
  expect(run.search).toHaveBeenCalledTimes(1);
  expect(runner).toHaveBeenCalledTimes(1);
  expect(run.search.mock.invocationCallOrder[0]).toBeLessThan(
    runner.mock.invocationCallOrder[0]!,
  );
});

test('denied search still returns the local analysis with a visible limitation', async () => {
  const runner = jest.fn(
    async (options: Parameters<typeof runDiseaseHypothesisAnalysis>[0]) => {
      expect(options.initialEvidence.items).toEqual([]);
      expect(
        options.tools.every(tool => tool.sourceKind !== 'external_medical'),
      ).toBe(true);
      return {
        status: 'workflow' as const,
        result: {
          status: 'result' as const,
          value: {
            hypotheses: [
              {
                title: '로컬 결과',
                summary: '기록 요약',
                uncertainty: '확인 필요',
                missingData: [],
                supportingEvidence: [],
                contraryEvidence: [],
              },
            ],
          },
          citations: [],
          coverage: [],
          checkpoint: {} as never,
        },
      };
    },
  );
  const run = workflowFixture(false, runner);
  const result = await run.services.generateDiseaseHypotheses();
  expect(run.search).not.toHaveBeenCalled();
  if (result.status !== 'workflow' || result.result.status !== 'result')
    throw new Error('Expected local result');
  expect(result.result.value.hypotheses[0]?.summary).toBe('기록 요약');
  expect(result.result.value.hypotheses[0]?.missingData.join(' ')).toContain(
    '동의가 없어',
  );
});

test('real feature orchestration combines default web search and a local tool within four model calls', async () => {
  const run = workflowFixture();
  const result = await run.services.sendRagMessage(
    'Compare my record with general public web sources.',
    [],
  );
  expect(result.status).toBe('answer');
  if (result.status !== 'answer')
    throw new Error('Expected a grounded workflow result');
  expect(result.answer).toContain('공개 웹자료를 바탕으로 AI가 정리한 설명');
  expect(result.citations.map(reference => reference.sourceKind)).toEqual(
    expect.arrayContaining(['reviewed_memory', 'external_medical']),
  );
  expect(run.generate).toHaveBeenCalledTimes(2);
  expect(run.search).toHaveBeenCalledTimes(1);
  expect(run.generate.mock.calls.length + run.search.mock.calls.length).toBe(3);
  expect(run.search).toHaveBeenCalledWith(
    {
      query:
        'General public health information about: general health. Guidelines, associations, possible explanations and limitations.',
    },
    { signal: expect.anything() },
  );
  expect(run.literature.search).not.toHaveBeenCalled();
  expect(
    run.authorize.mock.calls.filter(
      ([request]) => request.consentScope?.purpose === 'public_web_search',
    ),
  ).toHaveLength(1);
});

test('denied public-query permission preserves the local answer without switching destination or model', async () => {
  const run = workflowFixture(false);
  const result = await run.services.sendRagMessage(
    'Compare my record with public sources.',
    [],
  );
  expect(result.status).toBe('answer');
  if (result.status !== 'answer') throw new Error('Expected local answer');
  expect(result.answer).toContain('공개 웹검색 동의가 없어');
  expect(run.search).not.toHaveBeenCalled();
  expect(run.literature.search).not.toHaveBeenCalled();
  expect(run.generate).toHaveBeenCalledTimes(2);
});

test('a failed public lookup does not alone interrupt the local conversation turn', async () => {
  const run = workflowFixture();
  run.search.mockRejectedValueOnce(
    new Error('Synthetic public lookup failure'),
  );
  const result = await run.services.sendRagMessage(
    'Compare my record with public sources.',
    [],
  );
  expect(result.status).toBe('answer');
  expect(run.search).toHaveBeenCalledTimes(1);
  expect(run.generate).toHaveBeenCalledTimes(2);
});
