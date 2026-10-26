import { encounterCanonical } from '@orot/agent-runtime';
import type {
  EncounterCandidate,
  EncounterConflict,
} from '@orot/agent-runtime';
import type { RecordWriter } from '@orot/storage';

/** Conflicting facts remain separate records; confirming a new statement never overwrites existing medication history. */
export async function encounterConflicts(
  writer: RecordWriter,
  candidates: EncounterCandidate[],
): Promise<EncounterConflict[]> {
  const observations = (await writer.list('health_observation')).filter(
    record =>
      ['encounter_medication_statement', 'encounter_plan'].includes(
        record.concept,
      ),
  );
  const medications = await writer.list('medication_assertion');
  const conflicts: EncounterConflict[] = [];
  for (const candidate of candidates) {
    const concept =
      candidate.kind === 'medication'
        ? 'encounter_medication_statement'
        : 'encounter_plan';
    for (const record of observations.filter(
      item => item.concept === concept,
    )) {
      const proposed =
        candidate.text +
        (candidate.dosageInstruction ? '\n' + candidate.dosageInstruction : '');
      if (record.value.kind !== 'text' || record.value.text !== proposed)
        conflicts.push({
          candidateId: candidate.id,
          recordId: record.id,
          description:
            'A prior encounter statement differs; retain both until reviewed.',
          version: encounterCanonical(record),
        });
    }
    if (candidate.kind === 'medication') {
      for (const record of medications) {
        if (
          record.medicationName.toLocaleLowerCase() ===
            candidate.text.toLocaleLowerCase() &&
          record.dosageInstruction !== candidate.dosageInstruction
        )
          conflicts.push({
            candidateId: candidate.id,
            recordId: record.id,
            description:
              'Medication instructions differ from an existing assertion.',
            version: encounterCanonical(record),
          });
      }
    }
  }
  return conflicts.sort((a, b) =>
    encounterCanonical(a).localeCompare(encounterCanonical(b)),
  );
}
