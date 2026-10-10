import type { EvidenceItem } from '@orot/agent-runtime';
import {
  localEvidenceFingerprint,
  VISIT_QUESTION_RECORD_KINDS,
} from '../../agent/visitQuestions/evidence';
import type { VisitQuestionEvidenceItem } from '../../agent/visitQuestions/taskContract';
import type { LocalHealthEvidenceRecord } from '../../healthEvidence/localEvidenceRepository';
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

/** Narrows the JSON locator before the adapter reads structured-record fields. */
function isStructuredRecordLocator(
  locator: VisitQuestionEvidenceItem['locator'],
): locator is {
  readonly kind: 'structured_record';
  readonly recordId: string;
} {
  if (
    typeof locator !== 'object' ||
    locator === null ||
    Array.isArray(locator)
  ) {
    return false;
  }
  const candidate = locator as Readonly<Record<string, unknown>>;
  return (
    candidate.kind === 'structured_record' &&
    typeof candidate.recordId === 'string'
  );
}

/**
 * #30 fingerprints linked SourceRecords; typed fallback requires its empty-list
 * fingerprint as the provenance signal.
 */
function selfAnchoredStructuredRecordId(
  reference: VisitQuestionEvidenceItem,
): string | null {
  if (
    reference.sourceRevision !== localEvidenceFingerprint([]) ||
    reference.sourceId !== reference.evidenceId ||
    !isStructuredRecordLocator(reference.locator) ||
    reference.locator.recordId !== reference.evidenceId
  ) {
    return null;
  }
  return reference.evidenceId;
}

/** Reads an exact self-anchored record without guessing when table IDs collide. */
async function readSelfAnchoredRecord(
  repository: AiFeatureLocalData['repository'],
  recordId: string,
  signal: AbortSignal,
): Promise<EvidenceSourceReadResult> {
  const recordKinds = [...new Set(Object.values(VISIT_QUESTION_RECORD_KINDS))];
  const candidates = await Promise.all(
    recordKinds.map(async kind => {
      const record = await repository.readRecord(kind, recordId, signal);
      return record === null ? null : { kind, record };
    }),
  );
  const records = candidates.filter(
    (candidate): candidate is LocalHealthEvidenceRecord => candidate !== null,
  );
  if (records.length === 0) return { status: 'missing' };
  if (records.length !== 1) return { status: 'unavailable' };
  return {
    status: 'available',
    document: { sourceKind: 'personal_record', records },
  };
}

/** Registers #30 citations in the app source route without exposing their local IDs. */
export function createVisitQuestionSourceService(
  registry: LocalEvidenceReferenceRegistry,
  loadLocalData: () => Promise<AiFeatureLocalData>,
): VisitQuestionSourceService {
  return {
    registerVisitQuestionSource(reference, validate) {
      const { content, ...evidenceReference } = reference;
      return registry.add({
        // Keep display text outside the stable evidence identity used for later reads.
        reference: evidenceReference,
        content,
        validate: async signal => !signal.aborted && (await validate(signal)),
        async readSource(signal): Promise<EvidenceSourceReadResult> {
          if (signal.aborted || !(await validate(signal)))
            return { status: 'changed' };
          const data = await loadLocalData();
          if (reference.sourceKind === 'personal_record') {
            const structuredRecordId =
              selfAnchoredStructuredRecordId(reference);
            if (structuredRecordId) {
              return readSelfAnchoredRecord(
                data.repository,
                structuredRecordId,
                signal,
              );
            }
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
