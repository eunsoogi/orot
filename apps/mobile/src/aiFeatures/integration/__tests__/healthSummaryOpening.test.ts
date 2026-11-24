import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import { providerSuccess } from '@orot/model-runtime';
import { createHealthSummaryService } from '../healthSummaryService';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';
import { localData } from '../featureServiceFixtures';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import type { runDiseaseHypothesisAnalysis } from '../../../diseaseHypotheses/task';

/** Synthetic opening/reviewer outcomes, with the actual summary service dispatch boundary. */
test.each(['ALLOW', 'DENY', 'STOP'])(
  'summary preview %s preserves its existing final-work and cancellation gates',
  async verdict => {
    const f = publicEvidenceFixture();
    const controller = new AbortController();
    const order: string[] = [];
    const generate = jest
      .fn()
      .mockResolvedValueOnce(
        providerSuccess({
          text: '요청하신 기간의 흐름을 살펴볼게요.',
          toolCalls: [],
          finishReason: 'complete',
        }),
      )
      .mockResolvedValueOnce(
        providerSuccess({
          text: verdict === 'DENY' ? 'DENY' : 'ALLOW',
          toolCalls: [],
          finishReason: 'complete',
        }),
      );
    const selected = {
      ...f.selected,
      provider: {
        ...f.selected.provider,
        capabilities: { ...f.selected.provider.capabilities, streaming: false },
        generate,
      },
    };
    const runner = jest.fn(async () => {
      order.push('final-work');
      return { status: 'failure' } as never;
    });
    const service = createHealthSummaryService({
      selectedAi: async () => selected,
      loadData: async () => ({
        ...localData([]).data,
        readHealthContext: jest.fn(),
      }),
      registry: new LocalEvidenceReferenceRegistry(),
      consent: f.consent,
      runner: runner as unknown as typeof runDiseaseHypothesisAnalysis,
      createRunId: () => 'synthetic-summary',
    });
    const result = await service(
      { question: '최근 건강 기록을 요약해줘' },
      controller.signal,
      {
        onTaskStreamEvent: event => {
          if (event.type === 'initial_response') {
            order.push('opening');
            if (verdict === 'STOP') controller.abort();
          }
        },
      },
    );
    expect(order).toEqual(
      verdict === 'STOP'
        ? ['opening']
        : verdict === 'ALLOW'
          ? ['opening', 'final-work']
          : ['final-work'],
    );
    expect(runner).toHaveBeenCalledTimes(verdict === 'STOP' ? 0 : 1);
    expect(result).toEqual({
      failure: {
        status: 'failure',
        kind: verdict === 'STOP' ? 'cancelled' : 'retrieval_failed',
      },
    });
    expect(f.authorize.mock.calls[0]![0].consentScope?.purpose).toBe(
      'symptom_summary',
    );
  },
);

/** A reviewed Apple opening waiting on the protected journal is not model work. */
test('Stop immediately retires an on-device Health Summary opening held at protected delivery', async () => {
  const f = publicEvidenceFixture();
  const controller = new AbortController();
  const output = (text: string) =>
    providerSuccess({ text, toolCalls: [], finishReason: 'complete' });
  const generate = jest
    .fn()
    .mockResolvedValueOnce(output('요청하신 기간의 흐름을 살펴볼게요.'))
    .mockResolvedValueOnce(output('ALLOW'));
  const provider = {
    ...f.selected.provider,
    id: APPLE_PROVIDER_ID,
    capabilities: { ...f.selected.provider.capabilities, streaming: false },
    generate,
  };
  const selected = {
    ...f.selected,
    provider,
    remoteProcessing: false,
    option: {
      ...f.selected.option,
      provider,
      privacyBoundary: 'on-device' as const,
    },
  };
  const runner = jest.fn();
  const service = createHealthSummaryService({
    selectedAi: async () => selected,
    loadData: async () => ({
      ...localData([]).data,
      readHealthContext: jest.fn(),
    }),
    registry: new LocalEvidenceReferenceRegistry(),
    consent: f.consent,
    runner,
    createRunId: () => 'synthetic-summary-opening',
  });
  let reject!: () => void;
  let ready!: (signal: AbortSignal) => void;
  const entered = new Promise<AbortSignal>(resolve => {
    ready = resolve;
  });
  const onReviewedOpening = jest.fn((_value, signal: AbortSignal) => {
    ready(signal);
    return new Promise<boolean>((_resolve, drop) => {
      reject = () => drop(new Error('synthetic delayed journal rejection'));
    });
  });
  const onTaskStreamEvent = jest.fn();
  const result = service(
    { question: '최근 건강 기록을 요약해줘' },
    controller.signal,
    { inputOrigin: 'shortcut', onReviewedOpening, onTaskStreamEvent },
  );
  const journal = await entered;
  expect(generate).toHaveBeenCalledTimes(2);
  expect(runner).not.toHaveBeenCalled();
  expect(onTaskStreamEvent).not.toHaveBeenCalled();
  try {
    controller.abort();
    expect(journal.aborted).toBe(true);
    expect(
      await Promise.race([
        result,
        new Promise(resolve =>
          setImmediate(() => resolve('still waiting on journal')),
        ),
      ]),
    ).toEqual({ failure: { status: 'failure', kind: 'cancelled' } });
  } finally {
    reject();
    await result;
  }
  expect(onReviewedOpening).toHaveBeenCalledTimes(1);
  expect(runner).not.toHaveBeenCalled();
  expect(onTaskStreamEvent).not.toHaveBeenCalled();
});
