import type {
  SymptomSummaryStorage,
  SymptomSummaryHistory,
} from '../../diseaseHypotheses/savedSummaries';
import type {
  DiseaseHypothesisAnalysis,
  DiseaseHypothesisRunOutcome,
} from '../../diseaseHypotheses/types';
import type { SelectedAiResolution } from './provider';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import {
  captureSymptomSummarySources,
  restoreSymptomSummary,
} from './symptomSummarySources';

async function defaultStorage() {
  const { openLocalAgentMemoryDatabase } =
    await import('../../storage/secureDatabase');
  const { createSymptomSummaryStorage } =
    await import('../../storage/symptomSummaryStorage');
  return createSymptomSummaryStorage(await openLocalAgentMemoryDatabase());
}

/** Saving never invokes a provider; a failed write leaves the generated result visible with an explicit warning. */
export function createSymptomSummaryPersistence(input: {
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly data: () => Promise<AiFeatureLocalData>;
  readonly storage?: () => Promise<SymptomSummaryStorage>;
}) {
  let opening: Promise<SymptomSummaryStorage> | undefined;
  let retry: (() => Promise<DiseaseHypothesisAnalysis | null>) | undefined;
  const store = () =>
    (opening ??= (input.storage ?? defaultStorage)().catch(error => {
      opening = undefined;
      throw error;
    }));
  const history: SymptomSummaryHistory = {
    retrySave: async () => retry?.() ?? null,
    list: async before => (await store()).list(before),
    async read(id) {
      const saved = await (await store()).read(id);
      return saved
        ? restoreSymptomSummary(saved, input.registry, await input.data())
        : null;
    },
  };
  return {
    history,
    async save(
      outcome: DiseaseHypothesisRunOutcome,
      selected: Extract<SelectedAiResolution, { status: 'ready' }>,
      runId: string,
      signal: AbortSignal,
      createdAt = new Date().toISOString(),
    ): Promise<DiseaseHypothesisRunOutcome> {
      if (outcome.status !== 'workflow' || outcome.result.status !== 'result')
        return outcome;
      try {
        const captured = await captureSymptomSummarySources(
          outcome.result.value,
          input.registry,
          signal,
        );
        const id = `${createdAt}-${runId}`;
        await (
          await store()
        ).append({
          id,
          createdAt,
          providerId: selected.provider.id,
          modelId: selected.modelId,
          modelName: selected.option.displayName,
          ...captured,
        });
        retry = undefined;
        return {
          ...outcome,
          result: {
            ...outcome.result,
            value: {
              ...outcome.result.value,
              savedSummary: {
                status: 'saved',
                id,
                createdAt,
                modelName: selected.option.displayName,
              },
            },
          },
        };
      } catch {
        retry = async () => {
          const result = await this.save(
            outcome,
            selected,
            runId,
            new AbortController().signal,
            createdAt,
          );
          return result.status === 'workflow' &&
            result.result.status === 'result'
            ? result.result.value
            : null;
        };
        return {
          ...outcome,
          result: {
            ...outcome.result,
            value: {
              ...outcome.result.value,
              savedSummary: { status: 'failed' },
            },
          },
        };
      }
    },
  };
}
