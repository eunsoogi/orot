import { createTranscriptCorrection } from '@orot/domain';
import { extractTranscriptRecap } from '@orot/agent-runtime';
import { recapInput } from '../../../../../packages/domain/__tests__/recap-fixtures';
import { createRecapCompletion } from '../recapCompletion';

jest.mock('@orot/agent-runtime', () => ({ extractTranscriptRecap: jest.fn() }));
jest.mock('../../aiFeatures/integration/provider', () => ({
  resolveSelectedAiProvider: jest.fn(),
}));

it('passes only the latest transcript revision and selected model to extraction', async () => {
  const input = recapInput();
  const corrected = createTranscriptCorrection(
    input.segments[0],
    '수정된 전사',
    '2026-11-05T00:02:00Z',
  );
  const current = { ...input, segments: [corrected] };
  const loadInput = jest.fn(async () => current);
  const onOutcome = jest.fn(async () => undefined);
  const provider = { id: 'selected' };
  jest
    .mocked(extractTranscriptRecap)
    .mockResolvedValueOnce({ status: 'no_questions' });
  const completion = createRecapCompletion({
    loadInput,
    loadCurrent: async () => current,
    consent: { authorize: async () => 'authorized' },
    resolveSelected: async () =>
      ({
        status: 'ready',
        provider,
        modelId: 'chosen-model',
        recipient: 'account',
        remoteProcessing: true,
      }) as never,
    onOutcome,
  });
  const signal = new AbortController().signal;
  expect(
    await completion(
      input.recordingSourceId,
      [input.segments[0], corrected],
      signal,
    ),
  ).toEqual({ status: 'no_questions' });
  expect(loadInput).toHaveBeenCalledWith(input.recordingSourceId, [corrected]);
  const options = jest.mocked(extractTranscriptRecap).mock.calls[0][0];
  expect(options.execution).toMatchObject({
    providerId: 'selected',
    modelId: 'chosen-model',
  });
  expect(await options.isCurrent(current)).toBe(true);
  expect(await options.isCurrent(input)).toBe(false);
  expect(onOutcome).toHaveBeenCalledWith({ status: 'no_questions' }, signal);
});

it('reports missing visit binding without resolving or invoking a model', async () => {
  const input = recapInput();
  const resolveSelected = jest.fn();
  const onOutcome = jest.fn(async () => undefined);
  const completion = createRecapCompletion({
    loadInput: async () => null,
    loadCurrent: async () => null,
    consent: { authorize: async () => 'authorized' },
    resolveSelected,
    onOutcome,
  });
  expect(
    await completion(
      input.recordingSourceId,
      input.segments,
      new AbortController().signal,
    ),
  ).toEqual({ status: 'not_linked' });
  expect(resolveSelected).not.toHaveBeenCalled();
});
