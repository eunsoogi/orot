import { parseRecord } from '@orot/storage';
import type { RecordMap } from '@orot/storage';
import { SleepImportError } from './errors';
import {
  sleepAnalysisTypeIdentifier,
  type SleepDeviceMetadata,
  type SleepObservation,
} from './types';

const HEALTHKIT_SYSTEM = 'healthkit';
const SLEEP_RECORD_PREFIX = 'healthkit-sleep:';

/** Namespaces imported sample IDs so user-authored observations cannot collide. */
export function sleepObservationRecordId(sampleId: string): string {
  if (typeof sampleId !== 'string' || sampleId.trim().length === 0) {
    throw new SleepImportError(
      'INVALID_SLEEP_SAMPLE_ID',
      'A HealthKit sleep sample must include its stable ID.',
    );
  }
  return SLEEP_RECORD_PREFIX + sampleId.trim().toLowerCase();
}

/** Stores the raw HealthKit category as text; it is an enum, not a measurement. */
export function mapSleepObservationToHealthRecord(
  observation: SleepObservation,
  ingestedAt: string,
): RecordMap['health_observation'] {
  const source = observation.source;
  const device = persistableDevice(observation.device);

  return parseRecord('health_observation', {
    id: sleepObservationRecordId(observation.id),
    effectiveAt: observation.startDate,
    endedAt: observation.endDate,
    // HealthKit sleep samples do not provide a source creation timestamp.
    ingestedAt,
    provenance: {
      origin: 'imported',
      sourceRecordIds: [observation.id],
      source: {
        system: HEALTHKIT_SYSTEM,
        sourceIdentifier: source.identifier,
        sourceName: source.name,
        ...(nonEmptyText(source.revision?.version)
          ? { sourceVersion: source.revision?.version }
          : {}),
        ...(nonEmptyText(source.revision?.productType)
          ? { productType: source.revision?.productType }
          : {}),
        ...(device ? { device } : {}),
      },
    },
    reviewState: { status: 'unreviewed' },
    observationKind: 'other',
    concept: sleepAnalysisTypeIdentifier,
    value: { kind: 'text', text: String(observation.categoryValue) },
  });
}

function persistableDevice(
  value: SleepDeviceMetadata | null | undefined,
): Record<string, string> | undefined {
  if (!value) return undefined;
  const device = {
    ...(nonEmptyText(value.manufacturer)
      ? { manufacturer: value.manufacturer }
      : {}),
    ...(nonEmptyText(value.model) ? { model: value.model } : {}),
    ...(nonEmptyText(value.hardwareVersion)
      ? { hardwareVersion: value.hardwareVersion }
      : {}),
    ...(nonEmptyText(value.softwareVersion)
      ? { softwareVersion: value.softwareVersion }
      : {}),
  };
  return Object.keys(device).length > 0 ? device : undefined;
}

function nonEmptyText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
