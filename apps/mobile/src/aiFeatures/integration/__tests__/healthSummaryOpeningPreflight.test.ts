import { NativeModules } from 'react-native';
import { providerSuccess } from '@orot/model-runtime';
import type { runDiseaseHypothesisAnalysis } from '../../../diseaseHypotheses/task';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { apple, localData } from '../featureServiceFixtures';
import { createHealthSummaryService } from '../healthSummaryService';

function gate() {
  let open!: () => void;
  const done = new Promise<void>(resolve => {
    open = resolve;
  });
  return { done, open };
}

const opening = '요청하신 기간의 흐름을 살펴볼게요.';

function runFixture(
  outcome: 'completed' | 'failed' | 'unavailable' | 'cancelled' | 'remote',
) {
  const abort = new AbortController();
  const began = gate();
  const held = gate();
  const generate = jest
    .fn()
    .mockResolvedValueOnce(
      providerSuccess({
        text: opening,
        toolCalls: [],
        finishReason: 'complete',
      }),
    )
    .mockResolvedValueOnce(
      providerSuccess({
        text: 'ALLOW',
        toolCalls: [],
        finishReason: 'complete',
      }),
    );
  const provider = {
    ...apple.provider,
    capabilities: { ...apple.provider.capabilities, streaming: false },
    generate,
  };
  const runner = jest.fn(async () => ({ status: 'failure' }) as never);
  const onTaskStreamEvent = jest.fn();
  const authorize = jest.fn(async () => 'authorized' as const);
  const service = createHealthSummaryService({
    selectedAi: async () => ({
      status: 'ready',
      selection: { providerId: provider.id, modelId: apple.modelId },
      option: { ...apple, provider },
      provider,
      modelId: apple.modelId,
      recipient: outcome === 'remote' ? 'synthetic-remote' : 'on-device',
      remoteProcessing: outcome === 'remote',
    }),
    loadData: async () => {
      began.open();
      await held.done;
      if (outcome === 'failed')
        throw new Error('PRIVATE SYNTHETIC LOAD DETAIL');
      const { data } = localData([]);
      return outcome === 'unavailable'
        ? { ...data, readHealthContext: undefined }
        : { ...data, readHealthContext: jest.fn() };
    },
    registry: new LocalEvidenceReferenceRegistry(),
    consent: { authorize },
    runner: runner as unknown as typeof runDiseaseHypothesisAnalysis,
    createRunId: () => 'summary-preflight',
  });
  const result = service(
    { question: '최근 건강 기록을 요약해줘' },
    abort.signal,
    { inputOrigin: 'shortcut', onTaskStreamEvent },
  );
  return {
    abort,
    began,
    held,
    result,
    generate,
    runner,
    authorize,
    onTaskStreamEvent,
  };
}

test.each([
  'completed',
  'failed',
  'unavailable',
  'cancelled',
  'remote',
] as const)(
  'records the local opening preflight as %s without changing the request',
  async outcome => {
    const original = NativeModules.OrotProviderDiagnostics;
    const report = jest.fn();
    NativeModules.OrotProviderDiagnostics = { report };
    const state = runFixture(outcome);
    try {
      await state.began.done;
      const marker = () =>
        report.mock.calls
          .filter(([, stage]) => stage === 'opening_preflight')
          .map(([, , token]) => token);
      expect(marker()).toEqual(outcome === 'remote' ? [] : ['started']);
      expect(state.generate).not.toHaveBeenCalled();
      expect(state.authorize).not.toHaveBeenCalled();
      expect(state.onTaskStreamEvent).not.toHaveBeenCalled();
      expect(state.runner).not.toHaveBeenCalled();

      if (outcome === 'cancelled') state.abort.abort();
      state.held.open();
      await state.result;
      expect(marker()).toEqual(
        outcome === 'remote' ? [] : ['started', outcome],
      );
      const completed = outcome === 'completed' || outcome === 'remote';
      expect(state.generate).toHaveBeenCalledTimes(completed ? 2 : 0);
      expect(state.onTaskStreamEvent).toHaveBeenCalledTimes(completed ? 1 : 0);
      expect(state.runner).toHaveBeenCalledTimes(completed ? 1 : 0);
      if (outcome === 'completed') {
        const finished = report.mock.calls.findIndex(
          ([, stage, token]) =>
            stage === 'opening_preflight' && token === 'completed',
        );
        const generated = report.mock.calls.findIndex(
          ([, stage]) => stage === 'opening_generate',
        );
        expect(finished).toBeLessThan(generated);
        expect(state.authorize).not.toHaveBeenCalled();
      }
      expect(JSON.stringify(report.mock.calls)).not.toContain(
        'PRIVATE SYNTHETIC LOAD DETAIL',
      );
    } finally {
      state.held.open();
      await state.result;
      NativeModules.OrotProviderDiagnostics = original;
    }
  },
);
