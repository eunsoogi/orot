import type {
  LocalHealthEvidenceRecord,
  LocalHealthEvidenceRepository,
} from '../../healthEvidence/localEvidenceRepository';
import { linkedDoseMedication } from '../../healthEvidence/doseMedicationLink';
import type { EvidenceSourceReadResult } from './evidenceSourceDocument';
import { fingerprint } from './evidenceUtils';
import type { StaleEvidenceArtifact } from './localData';

/** A linked name is part of the exact source snapshot, including saving and later change/deletion checks. */
export function guardDoseMedicationSource(
  entry: LocalHealthEvidenceRecord,
  records: readonly LocalHealthEvidenceRecord[],
  repository: LocalHealthEvidenceRepository,
  readSource: (signal: AbortSignal) => Promise<EvidenceSourceReadResult>,
  loadStaleArtifacts: () => Promise<readonly StaleEvidenceArtifact[]>,
) {
  const expected = linkedDoseMedication(entry, records);
  async function readMedication(signal: AbortSignal) {
    if (signal.aborted) return { status: 'unavailable' } as const;
    // A genuinely unavailable name must not be guessed from another medication.
    if (!expected) return { status: 'available', entry: undefined } as const;
    const record = await repository.readRecord(
      expected.kind,
      expected.record.id,
      signal,
    );
    if (signal.aborted) return { status: 'unavailable' } as const;
    if (!record) return { status: 'missing' } as const;
    if (fingerprint(record) !== fingerprint(expected.record))
      return { status: 'changed' } as const;
    // Transcript invalidation can leave an unchanged row; its linked label must not outlive that invalidation.
    if (
      expected.kind === 'medication_assertion' &&
      expected.record.provenance.origin === 'derived'
    ) {
      const stale = await loadStaleArtifacts();
      if (signal.aborted) return { status: 'unavailable' } as const;
      if (
        stale.some(
          item => item.kind === expected.kind && item.id === expected.record.id,
        )
      )
        return { status: 'changed' } as const;
    }
    return {
      status: 'available',
      entry: { kind: expected.kind, record } as LocalHealthEvidenceRecord,
    } as const;
  }
  return {
    validate: async (signal: AbortSignal) =>
      (await readMedication(signal)).status === 'available',
    async readSource(signal: AbortSignal): Promise<EvidenceSourceReadResult> {
      const source = await readSource(signal);
      if (
        source.status !== 'available' ||
        source.document.sourceKind !== 'personal_record'
      )
        return source;
      const linked = await readMedication(signal);
      if (linked.status !== 'available') return linked;
      const medication = linked.entry;
      if (
        !medication ||
        source.document.records.some(
          record =>
            record.kind === medication.kind &&
            record.record.id === medication.record.id,
        )
      )
        return source;
      return {
        status: 'available',
        document: {
          ...source.document,
          records: [...source.document.records, medication],
        },
      };
    },
  };
}
