import { createAutomaticRecapWorkflow } from '../automaticRecapWorkflow';
import {
  recapInput,
  recapResult,
} from '../../../../../packages/domain/__tests__/recap-fixtures';

it('reuses committed analysis after a failed official write', async () => {
  const result = recapResult(recapInput());
  result.questions[0] = {
    ...result.questions[0],
    status: 'evidence_found',
    questionEvidence: [
      {
        segmentId: result.sources[0].segmentId,
        transcriptId: result.sources[0].transcriptId,
        revision: result.sources[0].revision,
        startOffset: 0,
        endOffset: 1,
        quote: 'x',
        audioRange: result.sources[0].audioRange,
      },
    ],
  };
  let cached: typeof result | null = null;
  const extract = jest.fn(async () => ({
    status: 'result' as const,
    value: result,
  }));
  const saveOfficial = jest
    .fn()
    .mockRejectedValueOnce(new Error('disk'))
    .mockResolvedValueOnce([]);
  const run = createAutomaticRecapWorkflow({
    readCurrent: async () => cached,
    extract,
    cache: async value => {
      cached = value;
    },
    saveOfficial,
  });
  const signal = new AbortController().signal;
  expect(await run(result.recordingSourceId, [], signal)).toEqual({
    status: 'save_failed',
  });
  expect(await run(result.recordingSourceId, [], signal)).toEqual({
    status: 'saved',
  });
  expect(extract).toHaveBeenCalledTimes(1);
});

it('reports a cache failure without reporting transcription failure or saved', async () => {
  const result = recapResult(recapInput());
  const statuses: string[] = [];
  const run = createAutomaticRecapWorkflow({
    readCurrent: async () => null,
    extract: async () => ({ status: 'result', value: result }),
    cache: async () => {
      throw new Error('disk');
    },
    saveOfficial: jest.fn(),
    beginStatus: async () => async status => {
      statuses.push(status);
    },
  });
  expect(
    await run(result.recordingSourceId, [], new AbortController().signal),
  ).toEqual({ status: 'save_failed' });
  expect(statuses).toEqual(['analyzing', 'save_failed']);
});
