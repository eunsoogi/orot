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

it('records a failure when loading cached work rejects', async () => {
  const statuses: string[] = [];
  const run = createAutomaticRecapWorkflow({
    readCurrent: async () => {
      throw new Error('disk');
    },
    extract: jest.fn(),
    cache: jest.fn(),
    saveOfficial: jest.fn(),
    beginStatus: async () => async status => {
      statuses.push(status);
    },
  });
  expect(
    await run('source-read-error', [], new AbortController().signal),
  ).toEqual({ status: 'save_failed' });
  expect(statuses).toEqual(['analyzing', 'save_failed']);
});

it('records a failure when input preparation rejects', async () => {
  const statuses: string[] = [];
  const run = createAutomaticRecapWorkflow({
    readCurrent: async () => null,
    extract: async () => {
      throw new Error('input unavailable');
    },
    cache: jest.fn(),
    saveOfficial: jest.fn(),
    beginStatus: async () => async status => {
      statuses.push(status);
    },
  });
  expect(
    await run('input-read-error', [], new AbortController().signal),
  ).toEqual({ status: 'save_failed' });
  expect(statuses).toEqual(['analyzing', 'save_failed']);
});

it('starts a replacement analysis when the recording is rebound during an older run', async () => {
  let binding = 'A';
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>(resolve => {
    started = resolve;
  });
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const extract = jest
    .fn()
    .mockImplementationOnce(async () => {
      started();
      await gate;
      return { status: 'stale_source' };
    })
    .mockResolvedValueOnce({ status: 'no_questions' });
  const run = createAutomaticRecapWorkflow({
    bindingKey: async () => binding,
    readCurrent: async () => null,
    extract,
    cache: jest.fn(),
    saveOfficial: jest.fn(),
  });
  const signal = new AbortController().signal;
  const first = run('same-recording', [], signal);
  await entered;
  binding = 'B';
  const second = run('same-recording', [], signal);
  release();
  expect(await first).toEqual({ status: 'stale_source' });
  expect(await second).toEqual({ status: 'no_questions' });
  expect(extract).toHaveBeenCalledTimes(2);
});
