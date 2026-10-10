import type {
  LocalHealthEvidenceInventory,
  LocalHealthEvidenceRecord,
  LocalHealthEvidenceRepository,
} from '../../healthEvidence/localEvidenceRepository';
import type { EvidenceSourceReadResult } from './evidenceRegistry';
import { fingerprint } from './evidenceUtils';

/** Reads the exact cited row and known local provenance rows without returning identifiers to model text. */
export function createPersonalSourceReader(input: {
  readonly record: LocalHealthEvidenceInventory['records'][number];
  readonly recordFingerprint: string;
  readonly sourceIds: readonly string[];
  readonly recordsById: ReadonlyMap<
    string,
    readonly LocalHealthEvidenceInventory['records'][number][]
  >;
  readonly repository: LocalHealthEvidenceRepository;
  readonly externalHealthKitIds: boolean;
}): (signal: AbortSignal) => Promise<EvidenceSourceReadResult> {
  return async signal => {
    if (signal.aborted) return { status: 'unavailable' };
    const currentRecord = await input.repository.readRecord(
      input.record.kind,
      input.record.record.id,
      signal,
    );
    if (!currentRecord) return { status: 'missing' };
    if (fingerprint(currentRecord) !== input.recordFingerprint)
      return { status: 'changed' };

    const records: LocalHealthEvidenceRecord[] = [
      {
        kind: input.record.kind,
        record: currentRecord,
      } as LocalHealthEvidenceRecord,
    ];
    for (const sourceId of input.sourceIds) {
      const candidates = input.recordsById.get(sourceId) ?? [];
      const dependencies = candidates.filter(
        candidate =>
          candidate.kind !== input.record.kind ||
          candidate.record.id !== input.record.record.id,
      );
      if (dependencies.length === 0) {
        const isSelfReference = candidates.some(
          candidate =>
            candidate.kind === input.record.kind &&
            candidate.record.id === input.record.record.id,
        );
        if (isSelfReference) continue;
        if (candidates.length === 0 && input.externalHealthKitIds) continue;
        return { status: 'missing' };
      }
      if (dependencies.length !== 1) return { status: 'unavailable' };
      const expected = dependencies[0];
      if (!expected) return { status: 'unavailable' };
      const currentSource = await input.repository.readRecord(
        expected.kind,
        sourceId,
        signal,
      );
      if (!currentSource) return { status: 'missing' };
      if (fingerprint(currentSource) !== fingerprint(expected.record))
        return { status: 'changed' };
      records.push({
        kind: expected.kind,
        record: currentSource,
      } as LocalHealthEvidenceRecord);
    }
    return signal.aborted
      ? { status: 'unavailable' }
      : {
          status: 'available',
          document: { sourceKind: 'personal_record', records },
        };
  };
}
