import { createHealthSummaryService } from '../healthSummaryService';
import { createConversationHealthSummary } from '../conversationHealthSummary';
import {
  apple,
  consent,
  localData,
  selectionStore,
} from '../featureServiceFixtures';
import { requireSelectedAi, resolveSelectedAiProvider } from '../provider';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import type { runDiseaseHypothesisAnalysis } from '../../../diseaseHypotheses/task';

test.each([
  ['consent_required', 'consent_required'],
  ['stale_evidence', 'stale_evidence'],
  ['invalid_output', 'validation_failed'],
] as const)('preserves %s workflow failure as %s', async (status, kind) => {
  const runner = (async () => ({
    status: 'workflow',
    result: { status, reason: 'synthetic', checkpoint: {} },
  })) as unknown as typeof runDiseaseHypothesisAnalysis;
  const service = createHealthSummaryService({
    selectedAi: async () =>
      requireSelectedAi(
        await resolveSelectedAiProvider({
          selectionStore: selectionStore({
            providerId: apple.provider.id,
            modelId: apple.modelId,
          }),
          loadAppleOption: async () => apple,
        }),
      ),
    loadData: async () => ({
      ...localData([]).data,
      readHealthContext: async () => {
        throw new Error('unused');
      },
    }),
    registry: new LocalEvidenceReferenceRegistry(),
    consent,
    runner,
    createRunId: () => 'run',
  });
  expect(
    await createConversationHealthSummary(service)(
      { question: '요약' },
      new AbortController().signal,
    ),
  ).toEqual({ status: 'failure', kind });
});

test('reports a failed local read separately from an empty result', async () => {
  const runner: typeof runDiseaseHypothesisAnalysis = async options => {
    try {
      await options.tools[0]!.search({
        operationRunId: 'run',
        operationKey: 'read',
        input: {},
        allowedScope: { sourceKinds: ['personal_record'] },
        resultLimit: 8,
        maxPayloadBytes: 20480,
        signal: new AbortController().signal,
      });
    } catch {
      /* Runtime can continue after a tool failure. */
    }
    return {
      status: 'workflow',
      result: {
        status: 'needs_clarification',
        message: 'No current evidence is available.',
        reason: 'empty',
        checkpoint: {},
      },
    } as never;
  };
  const service = createHealthSummaryService({
    selectedAi: async () =>
      requireSelectedAi(
        await resolveSelectedAiProvider({
          selectionStore: selectionStore({
            providerId: apple.provider.id,
            modelId: apple.modelId,
          }),
          loadAppleOption: async () => apple,
        }),
      ),
    loadData: async () => ({
      ...localData([]).data,
      readHealthContext: async () => {
        throw new Error('read failed');
      },
    }),
    registry: new LocalEvidenceReferenceRegistry(),
    consent,
    runner,
    createRunId: () => 'run',
  });
  expect(
    await createConversationHealthSummary(service)(
      { question: '요약' },
      new AbortController().signal,
    ),
  ).toEqual({ status: 'failure', kind: 'retrieval_failed' });
});

test('reports a completed empty search without treating it as a read failure', async () => {
  const runner = (async () => ({
    status: 'workflow',
    result: {
      status: 'needs_clarification',
      message: 'No current evidence is available.',
      reason: 'empty',
      checkpoint: {},
    },
  })) as unknown as typeof runDiseaseHypothesisAnalysis;
  const service = createHealthSummaryService({
    selectedAi: async () =>
      requireSelectedAi(
        await resolveSelectedAiProvider({
          selectionStore: selectionStore({
            providerId: apple.provider.id,
            modelId: apple.modelId,
          }),
          loadAppleOption: async () => apple,
        }),
      ),
    loadData: async () => ({
      ...localData([]).data,
      readHealthContext: async () => {
        throw new Error('unused');
      },
    }),
    registry: new LocalEvidenceReferenceRegistry(),
    consent,
    runner,
    createRunId: () => 'run',
  });
  expect(
    await createConversationHealthSummary(service)(
      { question: '요약' },
      new AbortController().signal,
    ),
  ).toEqual({ status: 'no_evidence' });
});
