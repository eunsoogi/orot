import { parseRecord } from '@orot/storage';
import type { RecordMap } from '@orot/storage';
import type { HealthKitMedicationQueryResult } from '../types';
import type { MedicationRepository, MedicationSyncResult } from './syncTypes';
import { medicationDefinitionId, preserveIngestedAt } from './syncIdentity';

/** Applies observed medication definitions; deletion needs a complete, non-empty snapshot. */
export async function applyDefinitionSnapshot(
  repository: MedicationRepository,
  result: HealthKitMedicationQueryResult,
  now: () => string,
): Promise<MedicationSyncResult['definitions']> {
  if (result.status !== 'completed' || result.availability !== 'available') {
    return {
      status: 'notRun',
      upserted: 0,
      deleted: 0,
      emptySnapshotPreserved: false,
      completeSnapshot: false,
    };
  }

  const ingestedAt = now();
  // HealthKit exposes no source timestamp for annotated medications, so neither source time is filled.
  const candidates = result.medications.map(medication =>
    parseRecord('medication_definition', {
      id: medicationDefinitionId(medication.conceptIdentifier),
      medicationConceptIdentifier: medication.conceptIdentifier,
      displayText: medication.displayText,
      generalForm: medication.generalForm,
      ...(medication.nickname ? { nickname: medication.nickname } : {}),
      isArchived: medication.isArchived,
      hasSchedule: medication.hasSchedule,
      ingestedAt,
      provenance: {
        origin: 'imported',
        sourceRecordIds: [medication.conceptIdentifier],
        source: { system: 'healthkit' },
      },
      reviewState: { status: 'unreviewed' },
    }),
  );
  const candidateIds = new Set(candidates.map(record => record.id));
  if (candidateIds.size !== candidates.length) {
    throw new Error(
      'HealthKit returned duplicate medication concept identifiers.',
    );
  }

  if (candidates.length === 0) {
    return {
      status: 'completed',
      upserted: 0,
      deleted: 0,
      emptySnapshotPreserved: true,
      completeSnapshot: result.completeSnapshot,
    };
  }

  let upserted = 0;
  let deleted = 0;
  await repository.transaction(async writer => {
    const existingRecords = await writer.list('medication_definition');
    for (const candidate of candidates) {
      const existing = await writer.get('medication_definition', candidate.id);
      const next = preserveIngestedAt(existing, candidate);
      if (next !== existing) {
        await writer.put(
          'medication_definition',
          next as RecordMap['medication_definition'],
        );
        upserted += 1;
      }
    }
    if (result.completeSnapshot) {
      // A HealthKit snapshot only owns definitions imported from HealthKit.
      for (const existing of existingRecords) {
        if (
          existing.provenance.origin === 'imported' &&
          existing.provenance.source?.system === 'healthkit' &&
          !candidateIds.has(existing.id) &&
          (await writer.delete('medication_definition', existing.id))
        ) {
          deleted += 1;
        }
      }
    }
  });
  return {
    status: 'completed',
    upserted,
    deleted,
    emptySnapshotPreserved: false,
    completeSnapshot: result.completeSnapshot,
  };
}
