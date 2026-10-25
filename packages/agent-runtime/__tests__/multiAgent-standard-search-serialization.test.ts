import { providerSuccess } from '@orot/model-runtime';
import { runMultiAgentWorkflow, type EvidenceBatch, type EvidenceSearchRequest } from '../src';
import { reference, scriptedOutputs } from './multiAgent-external-evidence-fixtures';
import { boundedSearchFixture, standardSearchFixture } from './multiAgent-standard-search-fixtures';

afterEach(() => jest.restoreAllMocks());

function transformSearch(
  run: ReturnType<typeof standardSearchFixture>,
  transform: (batch: EvidenceBatch, request: EvidenceSearchRequest) => EvidenceBatch,
) {
  const search = run.tool.search.getMockImplementation()!;
  jest.spyOn(run.tool, 'search').mockImplementation(async (request) => {
    const batch = await search(request);
    return 'status' in batch ? batch : transform(batch, request);
  });
}

test.each([false, true])('preserves bounded coverage field order, native=%s', async (native) => {
  const run = boundedSearchFixture(native);
  // Deliberately reverse the common field order: the trusted range must survive transport.
  const { timeRange } = run;
  const result = await runMultiAgentWorkflow(run.options);
  expect(result.status).toBe('result');
  expect(run.search).toHaveBeenCalledTimes(1);
  const message = run.requests.at(-1)?.messages.find((value) => value.role === 'user');
  if (message?.role !== 'user' || typeof message.content !== 'string')
    throw new Error('The revised task must receive the searched evidence.');
  const evidence = JSON.parse(message.content).evidence as EvidenceBatch;
  expect(JSON.stringify(evidence.coverage[0]?.requestedTimeRange)).toBe(JSON.stringify(timeRange));
});

test.each([false, true])('omits undefined optional result fields, native=%s', async (native) => {
  const run = standardSearchFixture(native);
  transformSearch(run, (batch) => ({
    ...batch,
    items: batch.items.map((item) => ({ ...item, unit: undefined })),
    coverage: batch.coverage.map((coverage) => ({ ...coverage, coveredTimeRange: undefined })),
  }));
  const result = await runMultiAgentWorkflow(run.options, { config: run.config });
  expect(result.status).toBe('result');
  const message = run.requests.at(-1)?.messages.find((value) => value.role === 'user');
  if (message?.role !== 'user' || typeof message.content !== 'string')
    throw new Error('The revised task must receive valid JSON evidence.');
  const evidence = JSON.parse(message.content).evidence as EvidenceBatch;
  expect(evidence.items[0]).not.toHaveProperty('unit');
  expect(evidence.coverage[0]).not.toHaveProperty('coveredTimeRange');
  expect(Object.keys(evidence.items[0]!.locator as object)).toEqual(
    Object.keys(reference.locator as object),
  );
  if (native) {
    const response = run.requests.at(-1)?.messages.find((value) => value.role === 'tool');
    if (response?.role !== 'tool') throw new Error('The native route must retain its tool result.');
    expect((response.result as unknown as EvidenceBatch).items[0]).not.toHaveProperty('unit');
    expect(
      Object.keys((response.result as unknown as EvidenceBatch).items[0]!.locator as object),
    ).toEqual(Object.keys(reference.locator as object));
  }
});

test.each([false, true])(
  'restores searched checkpoints using adapter field order, native=%s',
  async (native) => {
    const run = standardSearchFixture(native);
    let original: EvidenceBatch | undefined;
    transformSearch(run, (batch) => {
      original = batch;
      return batch;
    });
    const first = await runMultiAgentWorkflow(run.options, { config: run.config });
    expect(first.status).toBe('result');
    if (!original) throw new Error('The first graph run must search before restoration.');
    const restoreEvidence = jest.fn(async () => original!);
    run.provider.generate.mockResolvedValueOnce(
      providerSuccess({
        text: scriptedOutputs()[2]!,
        toolCalls: [],
        finishReason: 'complete',
      }),
    );
    // Re-enter at the resumable revision boundary with the references produced by the real search.
    const resumed = await runMultiAgentWorkflow(
      { ...run.options, checkpointer: undefined, restoreEvidence },
      { resumeFrom: { ...first.checkpoint, phase: 'revised_response', terminal: false } },
    );
    expect(restoreEvidence).toHaveBeenCalledTimes(1);
    expect(resumed.status).toBe('result');
    expect(run.search).toHaveBeenCalledTimes(1);
  },
);
