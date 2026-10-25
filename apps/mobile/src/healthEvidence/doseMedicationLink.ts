import type { LocalHealthEvidenceRecord } from './localEvidenceRepository';

/** Medication names are joined by the domain's typed forward link, never by coincident text or cross-table IDs. */
export function doseMedicationLink(entry: LocalHealthEvidenceRecord) {
  if (entry.kind !== 'dose_event') return undefined;
  return entry.record.eventKind === 'observed'
    ? {
        kind: 'medication_definition' as const,
        id: entry.record.medicationDefinitionId,
      }
    : {
        kind: 'medication_assertion' as const,
        id: entry.record.medicationAssertionId,
      };
}

export function linkedDoseMedication(
  entry: LocalHealthEvidenceRecord,
  records: readonly LocalHealthEvidenceRecord[],
) {
  const link = doseMedicationLink(entry);
  return (
    link &&
    records.find(
      candidate =>
        candidate.kind === link.kind && candidate.record.id === link.id,
    )
  );
}
