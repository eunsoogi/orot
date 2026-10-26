import {
  applyBloodPressureChanges,
  BLOOD_PRESSURE_CHECKPOINT_KEY,
} from './importChanges';
import type {
  BloodPressureRepository,
  BloodPressureSyncOptions,
  BloodPressureSyncResult,
} from './types';
import { rememberHealthKitAutoSyncRequest } from '../autoSyncCheckpoint';
import { resolveHealthKitSyncAuthorization } from '../syncAuthorization';

export const BLOOD_PRESSURE_PAGE_SIZE = 200;

const pageRequest = {
  feature: 'bloodPressure',
  sampleKind: 'bloodPressure',
  limit: BLOOD_PRESSURE_PAGE_SIZE,
} as const;

const syncTails = new WeakMap<BloodPressureRepository, Promise<void>>();

/** Serializes imports so each blood-pressure cursor has one active writer. */
export function syncHealthKitBloodPressure(
  options: BloodPressureSyncOptions,
): Promise<BloodPressureSyncResult> {
  const previous = syncTails.get(options.repository) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  syncTails.set(options.repository, tail);

  return previous
    .then(() => syncHealthKitBloodPressureExclusive(options))
    .finally(() => {
      release();
      if (syncTails.get(options.repository) === tail) {
        syncTails.delete(options.repository);
      }
    });
}

/** Applies anchored pages and commits each cursor before requesting the next page. */
async function syncHealthKitBloodPressureExclusive(
  options: BloodPressureSyncOptions,
): Promise<BloodPressureSyncResult> {
  const healthKit = options.healthKit;
  const authorization = await resolveHealthKitSyncAuthorization({
    permissionPreviouslyRequested: options.permissionPreviouslyRequested,
    authorization: options.authorization,
    requestAuthorization:
      'requestReadAuthorization' in healthKit
        ? () => healthKit.requestReadAuthorization('bloodPressure')
        : undefined,
    onRequestCompleted: options.rememberForAutoSync
      ? () =>
          rememberHealthKitAutoSyncRequest(
            options.repository,
            'bloodPressure',
            options.now,
          )
      : undefined,
    missingRequestMessage:
      'A batch authorization result is required before blood-pressure sync.',
  });
  if (
    authorization &&
    (authorization.availability !== 'available' ||
      authorization.requestStatus !== 'completed')
  ) {
    return {
      status: 'notRun',
      readAuthorization: 'notObservable',
      upserted: 0,
      deleted: 0,
      cursorAdvanced: false,
    };
  }

  const checkpoint = await options.repository.getSyncCheckpoint(
    BLOOD_PRESSURE_CHECKPOINT_KEY,
  );
  let cursor = checkpoint?.value ?? null;
  let upserted = 0;
  let deleted = 0;
  let cursorAdvanced = false;
  let pageCount = 0;

  while (true) {
    const result = await options.healthKit.querySampleChanges({
      ...pageRequest,
      cursor,
    });
    if (result.status !== 'completed' || result.availability !== 'available') {
      return {
        status: pageCount === 0 ? 'notRun' : 'partial',
        readAuthorization: result.readAuthorization,
        upserted,
        deleted,
        cursorAdvanced,
      };
    }
    if (result.hasMore && result.cursor === cursor) {
      throw new Error(
        'HealthKit returned a full blood-pressure page without advancing its cursor.',
      );
    }

    const changes = await applyBloodPressureChanges(
      options.repository,
      result,
      cursor,
      options.now,
    );
    upserted += changes.upserted;
    deleted += changes.deleted;
    cursorAdvanced ||= changes.cursorAdvanced;
    cursor = result.cursor ?? cursor;
    pageCount += 1;
    if (!result.hasMore) {
      return {
        status: 'completed',
        readAuthorization: result.readAuthorization,
        upserted,
        deleted,
        cursorAdvanced,
      };
    }
  }
}
