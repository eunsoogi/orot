import { createTranscriptCorrection } from '@orot/domain';
import { extractTranscriptRecap } from '@orot/agent-runtime';
import { recapInput } from '../../../../../packages/domain/__tests__/recap-fixtures';
import { createRecapCompletion } from '../recapCompletion';

jest.mock('@orot/agent-runtime', () => ({ extractTranscriptRecap: jest.fn() }));
jest.mock('../../aiFeatures/integration/provider', () => ({
  resolveSelectedAiProvider: jest.fn(),
}));

beforeEach(() => jest.clearAllMocks());

it.each(['invalid_output', 'cancelled', 'stale_source'] as const)(
  'forwards extraction %s without producing a successful result',
  async status => {
    const input = recapInput();
    const onOutcome = jest.fn(async () => undefined);
    jest.mocked(extractTranscriptRecap).mockResolvedValueOnce({ status });
    const completion = createRecapCompletion({
      loadInput: async () => input,
      loadCurrent: async () => input,
      consent: { authorize: async () => 'authorized' },
      resolveSelected: async () =>
        ({
          status: 'ready',
          provider: { id: 'selected' },
          modelId: 'chosen',
          recipient: 'local',
          remoteProcessing: false,
        }) as never,
      onOutcome,
    });
    const signal = new AbortController().signal;
    expect(
      await completion(input.recordingSourceId, input.segments, signal),
    ).toEqual({ status });
    expect(onOutcome).toHaveBeenCalledTimes(1);
    expect(onOutcome).toHaveBeenCalledWith({ status }, signal);
  },
);

it('uses the scoped plain transformation only for the selected Apple identity', async () => {
  const input = recapInput();
  jest
    .mocked(extractTranscriptRecap)
    .mockResolvedValueOnce({ status: 'no_questions' });
  const completion = createRecapCompletion({
    loadInput: async () => input,
    loadCurrent: async () => input,
    consent: { authorize: async () => 'authorized' },
    resolveSelected: async () =>
      ({
        status: 'ready',
        provider: { id: 'apple-foundation-models' },
        modelId: 'system-default',
        recipient: 'local',
        remoteProcessing: false,
      }) as never,
    onOutcome: async () => undefined,
  });
  await completion(
    input.recordingSourceId,
    input.segments,
    new AbortController().signal,
  );
  const options = jest.mocked(extractTranscriptRecap).mock.calls[0][0];
  expect(options.evidenceMode).toBe('references');
  expect(options.provider.id).toBe('apple-foundation-models');
  expect(options.provider.capabilities).toMatchObject({
    streaming: false,
    structuredOutput: false,
    toolCalling: false,
  });
  expect(options.execution.modelId).toBe('system-default');
});

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

it.each(['selection-required', 'unavailable'] as const)(
  'returns no_questions before model selection when the selection would be %s',
  async status => {
    const input = { ...recapInput(), questions: [] };
    const resolveSelected = jest.fn(async () => ({ status }));
    const completion = createRecapCompletion({
      loadInput: async () => input,
      loadCurrent: async () => input,
      consent: { authorize: async () => 'authorized' },
      resolveSelected,
      onOutcome: async () => undefined,
    });
    expect(
      await completion(
        input.recordingSourceId,
        input.segments,
        new AbortController().signal,
      ),
    ).toEqual({ status: 'no_questions' });
    expect(resolveSelected).not.toHaveBeenCalled();
  },
);

it.each(['load', 'selection'] as const)(
  'returns cancellation while %s is pending and ignores its late failure',
  async stage => {
    const input = recapInput();
    let rejectPending!: (error: Error) => void;
    const pending = new Promise<never>((_, reject) => {
      rejectPending = reject;
    });
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => {
      markStarted = resolve;
    });
    const wait = () => {
      markStarted();
      return pending;
    };
    const resolveSelected = jest.fn(wait);
    const onOutcome = jest.fn(async () => undefined);
    const completion = createRecapCompletion({
      loadInput: stage === 'load' ? wait : async () => input,
      loadCurrent: async () => input,
      consent: { authorize: async () => 'authorized' },
      resolveSelected,
      onOutcome,
    });
    const controller = new AbortController();
    const result = completion(
      input.recordingSourceId,
      input.segments,
      controller.signal,
    );
    await started;
    controller.abort();
    expect(await result).toEqual({ status: 'cancelled' });
    rejectPending(new Error('late failure'));
    await Promise.resolve();
    expect(onOutcome).toHaveBeenCalledTimes(1);
    expect(onOutcome).toHaveBeenCalledWith(
      { status: 'cancelled' },
      controller.signal,
    );
    expect(extractTranscriptRecap).not.toHaveBeenCalled();
  },
);
