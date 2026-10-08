import type { EvidenceItem } from '@orot/agent-runtime';
import type { VisitQuestionEvidenceItem } from '../../agent/visitQuestions/taskContract';
import type { AiFeatureLocalData } from './localData';
import type {
  EvidenceSourceReadResult,
  LocalEvidenceReferenceRegistry,
} from './evidenceRegistry';

export interface VisitQuestionSourceService {
  registerVisitQuestionSource(
    reference: VisitQuestionEvidenceItem,
    validate: (signal: AbortSignal) => Promise<boolean>,
  ): EvidenceItem;
}

/** Registers #30 citations in the app source route without exposing their local IDs. */
export function createVisitQuestionSourceService(
  registry: LocalEvidenceReferenceRegistry,
  loadLocalData: () => Promise<AiFeatureLocalData>,
): VisitQuestionSourceService {
  return {
    registerVisitQuestionSource(reference, validate) {
      return registry.add({
        reference,
        content: reference.content,
        validate: async signal => !signal.aborted && (await validate(signal)),
        async readSource(signal): Promise<EvidenceSourceReadResult> {
          if (signal.aborted || !(await validate(signal)))
            return { status: 'changed' };
          const data = await loadLocalData();
          if (reference.sourceKind === 'personal_record') {
            const result = await data.repository.querySource(
              reference.sourceId,
              { signal },
            );
            if (result.status === 'source_missing')
              return { status: 'missing' };
            if (!result.complete) return { status: 'unavailable' };
            return {
              status: 'available',
              document: {
                sourceKind: 'personal_record',
                records: result.records,
              },
            };
          }
          if (reference.sourceKind === 'reviewed_memory') {
            const record = (await data.loadMemoryRecords()).find(
              candidate => candidate.id === reference.sourceId,
            );
            return record
              ? {
                  status: 'available',
                  document: { sourceKind: 'reviewed_memory', record },
                }
              : { status: 'missing' };
          }
          return { status: 'unavailable' };
        },
      });
    },
  };
}
