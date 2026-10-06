import {
  applyBloodPressureChanges,
  BLOOD_PRESSURE_CHECKPOINT_KEY,
} from './importChanges';
import type {
  BloodPressureSyncOptions,
  BloodPressureSyncResult,
} from './types';

export const BLOOD_PRESSURE_PAGE_SIZE = 200;

const pageRequest = {
  feature: 'bloodPressure',
  sampleKind: 'bloodPressure',
  limit: BLOOD_PRESSURE_PAGE_SIZE,
} as const;

/** Applies anchored HealthKit pages before fetching the next cursor. */
export async function syncHealthKitBloodPressure(
  options: BloodPressureSyncOptions,
): Promise<BloodPressureSyncResult> {
  const authorization =
    await options.healthKit.requestReadAuthorization('bloodPressure');
  // HealthKit keeps read grants opaque; request completion is not a grant result.
  if (
    authorization.availability !== 'available' ||
    authorization.requestStatus !== 'completed'
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
