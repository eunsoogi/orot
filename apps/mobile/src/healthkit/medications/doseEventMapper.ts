import { parseRecord } from '@orot/storage';
import type { RecordMap } from '@orot/storage';
import type { HealthKitSampleSnapshot } from '../types';
import { doseEventId, medicationDefinitionId, nonEmpty } from './syncIdentity';

/** Maps a dose log as an observed event; absence never becomes a missed-dose assertion. */
export function mapDoseEvent(
  sample: HealthKitSampleSnapshot,
  ingestedAt: string,
): RecordMap['dose_event'] {
  if (
    sample.typeIdentifier !==
      'HKMedicationDoseEventTypeIdentifierMedicationDoseEvent' ||
    !sample.medicationConceptIdentifier
  ) {
    throw new Error('HealthKit returned an invalid medication dose event.');
  }

  const source = {
    system: 'healthkit',
    ...(nonEmpty(sample.sourceIdentifier)
      ? { sourceIdentifier: sample.sourceIdentifier }
      : {}),
    ...(nonEmpty(sample.sourceName) ? { sourceName: sample.sourceName } : {}),
    ...(nonEmpty(sample.sourceVersion)
      ? { sourceVersion: sample.sourceVersion }
      : {}),
    ...(nonEmpty(sample.sourceProductType)
      ? { productType: sample.sourceProductType }
      : {}),
    ...(deviceMetadata(sample.device)
      ? { device: deviceMetadata(sample.device) }
      : {}),
  };
  const quantity = sample.doseQuantity;
  if (quantity !== undefined && (!Number.isFinite(quantity) || quantity < 0)) {
    throw new Error('HealthKit returned an invalid dose quantity.');
  }
  if (quantity !== undefined && !nonEmpty(sample.doseUnit)) {
    throw new Error('HealthKit returned a dose quantity without a unit.');
  }

  return parseRecord('dose_event', {
    id: doseEventId(sample.id),
    effectiveAt: sample.startDate,
    endedAt: sample.endDate,
    ...(sample.scheduledDate ? { scheduledAt: sample.scheduledDate } : {}),
    ingestedAt,
    provenance: { origin: 'imported', sourceRecordIds: [sample.id], source },
    reviewState: { status: 'unreviewed' },
    eventKind: 'observed',
    medicationDefinitionId: medicationDefinitionId(
      sample.medicationConceptIdentifier,
    ),
    observationStatus: observationStatus(
      sample.doseStatusName,
      sample.doseStatus,
    ),
    ...(Number.isInteger(sample.doseStatus)
      ? { sourceStatusCode: sample.doseStatus }
      : {}),
    ...(Number.isInteger(sample.scheduleType)
      ? { sourceScheduleTypeCode: sample.scheduleType }
      : {}),
    ...(scheduleType(sample.scheduleTypeName, sample.scheduleType)
      ? {
          scheduleType: scheduleType(
            sample.scheduleTypeName,
            sample.scheduleType,
          ),
        }
      : {}),
    ...(nonEmpty(sample.doseUnit)
      ? {
          dose: {
            unit: sample.doseUnit,
            ...(quantity !== undefined ? { amount: quantity } : {}),
          },
        }
      : {}),
  });
}

function observationStatus(
  statusName: HealthKitSampleSnapshot['doseStatusName'],
  statusCode: number | undefined,
): string {
  if (statusName) {
    const names = {
      notInteracted: 'not_interacted',
      notificationNotSent: 'notification_not_sent',
      snoozed: 'snoozed',
      taken: 'taken',
      skipped: 'skipped',
      notLogged: 'not_logged',
      unknown: 'unknown',
    } as const;
    return names[statusName];
  }
  // These raw values follow HKMedicationDoseEvent.LogStatus in the native SDK.
  return (
    (
      {
        1: 'not_interacted',
        2: 'notification_not_sent',
        3: 'snoozed',
        4: 'taken',
        5: 'skipped',
        6: 'not_logged',
      } as Record<number, string>
    )[statusCode ?? -1] ?? 'unknown'
  );
}

function scheduleType(
  scheduleName: HealthKitSampleSnapshot['scheduleTypeName'],
  scheduleCode: number | undefined,
): 'as_needed' | 'scheduled' | undefined {
  if (scheduleName === 'asNeeded') return 'as_needed';
  if (scheduleName === 'schedule') return 'scheduled';
  if (scheduleName === 'unknown') return undefined;
  if (scheduleCode === 1) return 'as_needed';
  if (scheduleCode === 2) return 'scheduled';
  return undefined;
}

function deviceMetadata(
  device: HealthKitSampleSnapshot['device'],
): HealthKitSampleSnapshot['device'] | undefined {
  if (!device) return undefined;
  const result = {
    ...(nonEmpty(device.manufacturer)
      ? { manufacturer: device.manufacturer }
      : {}),
    ...(nonEmpty(device.model) ? { model: device.model } : {}),
    ...(nonEmpty(device.hardwareVersion)
      ? { hardwareVersion: device.hardwareVersion }
      : {}),
    ...(nonEmpty(device.softwareVersion)
      ? { softwareVersion: device.softwareVersion }
      : {}),
  };
  return Object.keys(result).length > 0 ? result : undefined;
}
