import type { HealthKitAuthorizationResult } from '../types';
import { healthKitSampleChangesCheckpointKey } from '../sampleChangesCheckpoint';
import {
  commonObservationRecordId,
  mapCommonObservationSample,
  toCommonObservationRecord,
} from './mapper';
import { preserveIngestedAt } from './syncIdentity';
import type {
  CommonObservationRepository,
  SyncCommonObservationChangesOptions,
} from './syncOptions';
import type { CommonObservationFeature } from './types';

export type {
  CommonObservationRepository,
  SyncCommonObservationChangesOptions,
} from './syncOptions';

const PAGE_SIZE = 200;

export type CommonObservationSyncStatus =
  | 'complete'
  | 'empty'
  | 'unavailable'
  | 'unsupportedFeature'
  | 'unsupportedPlatform'
  | 'unsupportedData'
  | 'partial';

export interface CommonObservationSyncResult {
  readonly status: CommonObservationSyncStatus;
  readonly readAuthorization: 'notObservable';
  readonly upserted: number;
  readonly deleted: number;
  readonly skipped: number;
  readonly cursorAdvanced: boolean;
}

const pendingSyncs = new WeakMap<
  CommonObservationRepository,
  Map<CommonObservationFeature, Promise<void>>
>();

/** Serializes same-feature runs because screen navigation can remount an importer. */
export function syncCommonObservationChanges(
  options: SyncCommonObservationChangesOptions,
): Promise<CommonObservationSyncResult> {
  return serializeFeatureSync(options, () =>
    syncCommonObservationChangesExclusive(options),
  );
}

/** Commits each complete native page before using its opaque cursor for the next one. */
async function syncCommonObservationChangesExclusive(
  options: SyncCommonObservationChangesOptions,
): Promise<CommonObservationSyncResult> {
  const { feature, healthKit, repository, now } = options;
  // A completed outer batch avoids a second prompt; standalone sync keeps its single-feature request.
  let authorization: HealthKitAuthorizationResult;
  if (options.authorization) {
    authorization = options.authorization;
  } else if ('requestReadAuthorization' in healthKit) {
    authorization = await healthKit.requestReadAuthorization(feature);
  } else {
    throw new Error(
      'A feature-scoped authorization result is required before sync.',
    );
  }
  if (authorization.availability !== 'available') {
    return result(authorization.availability, 0, 0, 0, false);
  }
  if (authorization.requestStatus !== 'completed') {
    return result('unavailable', 0, 0, 0, false);
  }

  const checkpointKey = healthKitSampleChangesCheckpointKey(feature, feature);
  const savedCheckpoint = await repository.getSyncCheckpoint(checkpointKey);
  let cursor = savedCheckpoint?.value ?? null;
  let upserted = 0;
  let deleted = 0;
  let skipped = 0;
  let cursorAdvanced = false;
  let pageCount = 0;

  while (true) {
    const page = await healthKit.querySampleChanges({
      feature,
      sampleKind: feature,
      limit: PAGE_SIZE,
      cursor,
    });
    if (page.status !== 'completed' || page.availability !== 'available') {
      return result(
        pageCount === 0 ? page.availability : 'partial',
        upserted,
        deleted,
        skipped,
        cursorAdvanced,
      );
    }
    if (page.hasMore && page.cursor === cursor) {
      throw new Error(
        'HealthKit returned a full observation page without advancing its cursor.',
      );
    }

    const ingestedAt = now();
    const mappings = page.addedSamples.map(sample =>
      mapCommonObservationSample(feature, sample),
    );
    const rejectedCount = mappings.filter(
      mapping => mapping.status === 'skipped',
    ).length;
    if (rejectedCount > 0) {
      // Do not advance past a sample this version cannot represent; a later app can retry it.
      return result(
        pageCount === 0 ? 'unsupportedData' : 'partial',
        upserted,
        deleted,
        skipped + rejectedCount,
        cursorAdvanced,
      );
    }

    const candidates = mappings.map(mapping => {
      if (mapping.status !== 'mapped') {
        throw new Error(
          'A validated HealthKit observation mapping changed unexpectedly.',
        );
      }
      return toCommonObservationRecord(mapping.observation, ingestedAt);
    });
    const candidateIds = new Set(candidates.map(record => record.id));
    if (candidateIds.size !== candidates.length) {
      throw new Error(
        'HealthKit returned duplicate common observation identifiers.',
      );
    }
    const deletedIds = new Set(
      page.deletedSampleIds.map(id => commonObservationRecordId(feature, id)),
    );
    if (
      deletedIds.size !== page.deletedSampleIds.length ||
      [...candidateIds].some(id => deletedIds.has(id))
    ) {
      throw new Error(
        'HealthKit returned conflicting common observation identifiers.',
      );
    }

    const nextCursor = page.cursor ?? cursor;
    const pageHasChanges = candidates.length > 0 || deletedIds.size > 0;
    if (pageHasChanges && nextCursor === cursor) {
      throw new Error(
        'HealthKit returned observation changes without advancing its cursor.',
      );
    }
    const pageCursorAdvanced = nextCursor !== cursor;
    if (pageHasChanges || pageCursorAdvanced) {
      await repository.transaction(async writer => {
        for (const candidate of candidates) {
          const existing = await writer.get('health_observation', candidate.id);
          const next = preserveIngestedAt(existing, candidate);
          if (next !== existing) {
            await writer.put('health_observation', next);
            upserted += 1;
          }
        }
        for (const id of deletedIds) {
          if (await writer.delete('health_observation', id)) deleted += 1;
        }
        if (pageCursorAdvanced && nextCursor) {
          await writer.putSyncCheckpoint({
            key: checkpointKey,
            value: nextCursor,
            updatedAt: now(),
          });
        }
      });
    }

    cursor = nextCursor;
    cursorAdvanced ||= pageCursorAdvanced;
    pageCount += 1;
    if (!page.hasMore) {
      return result(
        upserted > 0 || deleted > 0 ? 'complete' : 'empty',
        upserted,
        deleted,
        skipped,
        cursorAdvanced,
      );
    }
  }
}

function serializeFeatureSync<T>(
  options: SyncCommonObservationChangesOptions,
  operation: () => Promise<T>,
): Promise<T> {
  const lockIdentity = options.serializationIdentity ?? options.repository;
  let featureTails = pendingSyncs.get(lockIdentity);
  if (!featureTails) {
    featureTails = new Map();
    pendingSyncs.set(lockIdentity, featureTails);
  }

  const previous = featureTails.get(options.feature) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  featureTails.set(options.feature, tail);

  return previous.then(operation).finally(() => {
    release();
    if (featureTails?.get(options.feature) === tail) {
      featureTails.delete(options.feature);
      if (featureTails.size === 0) pendingSyncs.delete(lockIdentity);
    }
  });
}

function result(
  status: CommonObservationSyncStatus,
  upserted: number,
  deleted: number,
  skipped: number,
  cursorAdvanced: boolean,
): CommonObservationSyncResult {
  return {
    status,
    readAuthorization: 'notObservable',
    upserted,
    deleted,
    skipped,
    cursorAdvanced,
  };
}
