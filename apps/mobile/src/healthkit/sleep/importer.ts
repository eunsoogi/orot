import type { RecordRepository } from '@orot/storage';
import type { HealthKitNativeModule, HealthKitSampleSnapshot } from '../types';
import { healthKitSampleChangesCheckpointKey } from '../sampleChangesCheckpoint';
import { SleepImportError } from './errors';
import {
  mapSleepObservationToHealthRecord,
  sleepObservationRecordId,
} from './recordMapper';
import { applySleepChanges } from './sync';
import type { HealthKitSleepSampleSnapshot, SleepImportState } from './types';

export const SLEEP_SAMPLE_PAGE_SIZE = 200;
export const SLEEP_SAMPLE_CHECKPOINT_KEY = healthKitSampleChangesCheckpointKey(
  'sleep',
  'sleep',
);

export type SleepHealthKitClient = Pick<
  HealthKitNativeModule,
  'querySampleChanges'
>;
export type SleepSyncRepository = Pick<
  RecordRepository,
  'getSyncCheckpoint' | 'transaction'
>;

export interface SleepSyncOptions {
  readonly healthKit: SleepHealthKitClient;
  readonly repository: SleepSyncRepository;
  readonly now: () => string;
}

export interface SleepSyncResult {
  readonly status: 'completed' | 'notRun' | 'partial';
  readonly availability:
    'available' | 'unavailable' | 'unsupportedFeature' | 'unsupportedPlatform';
  readonly readAuthorization: 'notObservable';
  readonly upserted: number;
  readonly deleted: number;
  readonly cursorAdvanced: boolean;
  readonly pages: number;
}

/**
 * Imports anchored sleep pages and persists each page before requesting another.
 * Record mutations and the opaque HealthKit cursor share one database transaction.
 */
export async function syncHealthKitSleep(
  options: SleepSyncOptions,
): Promise<SleepSyncResult> {
  const checkpoint = await options.repository.getSyncCheckpoint(
    SLEEP_SAMPLE_CHECKPOINT_KEY,
  );
  let cursor = checkpoint?.value ?? null;
  let upserted = 0;
  let deleted = 0;
  let cursorAdvanced = false;
  let pages = 0;

  while (true) {
    const result = await options.healthKit.querySampleChanges({
      feature: 'sleep',
      sampleKind: 'sleep',
      limit: SLEEP_SAMPLE_PAGE_SIZE,
      cursor,
    });
    if (result.status !== 'completed' || result.availability !== 'available') {
      return {
        status: pages === 0 ? 'notRun' : 'partial',
        availability: result.availability,
        readAuthorization: result.readAuthorization,
        upserted,
        deleted,
        cursorAdvanced,
        pages,
      };
    }

    const nextCursor = result.cursor ?? cursor;
    const pageState = applySleepChanges(
      { samples: [], anchor: cursor } satisfies SleepImportState,
      {
        addedOrUpdated: result.addedSamples.map(toSleepSampleSnapshot),
        deletedSampleIds: result.deletedSampleIds,
        nextAnchor: nextCursor,
        complete: true,
      },
    );
    const upsertIds = pageState.samples.map(sample =>
      sleepObservationRecordId(sample.id),
    );
    const deletedIds = result.deletedSampleIds.map(sleepObservationRecordId);
    const upsertIdSet = new Set(upsertIds);
    const deletedIdSet = new Set(deletedIds);
    if (
      upsertIdSet.size !== upsertIds.length ||
      deletedIdSet.size !== deletedIds.length ||
      [...upsertIdSet].some(id => deletedIdSet.has(id))
    ) {
      throw new SleepImportError(
        'CONFLICTING_SLEEP_SYNC_DELTA',
        'A HealthKit page contains duplicate or conflicting sleep IDs.',
      );
    }
    const hasChanges = pageState.samples.length > 0 || deletedIds.length > 0;
    if (nextCursor === cursor && (result.hasMore || hasChanges)) {
      // Advancing stored changes without advancing their anchor would replay them forever.
      throw new SleepImportError(
        'STALLED_SLEEP_CURSOR',
        'A HealthKit sleep page with more rows or changes must advance its cursor.',
      );
    }

    const advanced = nextCursor !== null && nextCursor !== cursor;
    if (pageState.samples.length > 0 || deletedIds.length > 0 || advanced) {
      const transactionTime = options.now();
      const candidates = pageState.samples.map(sample =>
        mapSleepObservationToHealthRecord(sample, transactionTime),
      );
      let pageUpserted = 0;
      let pageDeleted = 0;
      await options.repository.transaction(async writer => {
        for (const candidate of candidates) {
          const existing = await writer.get('health_observation', candidate.id);
          const next = preserveSleepIngestedAt(existing, candidate);
          if (next !== existing) {
            await writer.put('health_observation', next);
            pageUpserted += 1;
          }
        }
        for (const id of deletedIds) {
          if (await writer.delete('health_observation', id)) pageDeleted += 1;
        }
        if (advanced && nextCursor) {
          await writer.putSyncCheckpoint({
            key: SLEEP_SAMPLE_CHECKPOINT_KEY,
            value: nextCursor,
            updatedAt: transactionTime,
          });
        }
      });
      upserted += pageUpserted;
      deleted += pageDeleted;
    }

    cursorAdvanced ||= advanced;
    cursor = nextCursor;
    pages += 1;
    if (!result.hasMore) {
      return {
        status: 'completed',
        availability: 'available',
        readAuthorization: result.readAuthorization,
        upserted,
        deleted,
        cursorAdvanced,
        pages,
      };
    }
  }
}

function toSleepSampleSnapshot(
  sample: HealthKitSampleSnapshot,
): HealthKitSleepSampleSnapshot {
  if (typeof sample.categoryValue !== 'number') {
    throw new SleepImportError(
      'INVALID_SLEEP_CATEGORY',
      'A HealthKit sleep sample must include its category value.',
    );
  }
  return {
    id: sample.id,
    typeIdentifier: sample.typeIdentifier,
    startDate: sample.startDate,
    endDate: sample.endDate,
    categoryValue: sample.categoryValue,
    sourceIdentifier: sample.sourceIdentifier,
    sourceName: sample.sourceName,
    ...(sample.sourceVersion === undefined
      ? {}
      : { sourceVersion: sample.sourceVersion }),
    ...(sample.sourceProductType === undefined
      ? {}
      : { sourceProductType: sample.sourceProductType }),
    ...(sample.device === undefined ? {} : { device: sample.device }),
  };
}

function preserveSleepIngestedAt<T extends { readonly ingestedAt: string }>(
  existing: T | null,
  candidate: T,
): T {
  if (!existing) return candidate;
  const replay = { ...candidate, ingestedAt: existing.ingestedAt };
  return JSON.stringify(replay) === JSON.stringify(existing)
    ? existing
    : candidate;
}
