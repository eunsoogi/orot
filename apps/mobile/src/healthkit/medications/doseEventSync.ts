import type { SyncCheckpoint } from '@orot/storage';
import type { HealthKitNativeModule } from '../types';
import {
  DOSE_EVENT_CHECKPOINT_KEY,
  MEDICATION_DOSE_EVENT_PAGE_SIZE,
  type MedicationRepository,
  type MedicationSyncResult,
} from './syncTypes';
import { mapDoseEvent } from './doseEventMapper';
import { doseEventId, preserveIngestedAt } from './syncIdentity';

const pageRequest = {
  feature: 'medications',
  sampleKind: 'medicationDoseEvents',
  limit: MEDICATION_DOSE_EVENT_PAGE_SIZE,
} as const;

/** Commits each bounded page before asking HealthKit for the next anchor. */
export async function syncDoseEventChanges(
  healthKit: Pick<HealthKitNativeModule, 'querySampleChanges'>,
  repository: MedicationRepository,
  checkpoint: SyncCheckpoint | null,
  now: () => string,
): Promise<MedicationSyncResult['doseEvents']> {
  let cursor = checkpoint?.value ?? null;
  let upserted = 0;
  let deleted = 0;
  let cursorAdvanced = false;
  let pageCount = 0;

  while (true) {
    const result = await healthKit.querySampleChanges({
      ...pageRequest,
      cursor,
    });
    if (result.status !== 'completed' || result.availability !== 'available') {
      return {
        status: pageCount === 0 ? 'notRun' : 'partial',
        upserted,
        deleted,
        cursorAdvanced,
      };
    }
    if (result.hasMore && result.cursor === cursor) {
      throw new Error(
        'HealthKit returned a full dose-event page without advancing its cursor.',
      );
    }

    const changes = await applyDoseEventPage(repository, result, cursor, now);
    upserted += changes.upserted;
    deleted += changes.deleted;
    cursorAdvanced ||= changes.cursorAdvanced;
    cursor = result.cursor ?? cursor;
    pageCount += 1;
    if (!result.hasMore) {
      return { status: 'completed', upserted, deleted, cursorAdvanced };
    }
  }
}

async function applyDoseEventPage(
  repository: MedicationRepository,
  result: Extract<
    Awaited<ReturnType<HealthKitNativeModule['querySampleChanges']>>,
    { status: 'completed' }
  >,
  previousCursor: string | null,
  now: () => string,
): Promise<{ upserted: number; deleted: number; cursorAdvanced: boolean }> {
  const ingestedAt = now();
  const candidates = result.addedSamples.map(sample =>
    mapDoseEvent(sample, ingestedAt),
  );
  const candidateIds = new Set(candidates.map(record => record.id));
  if (candidateIds.size !== candidates.length) {
    throw new Error(
      'HealthKit returned duplicate medication dose event identifiers.',
    );
  }
  const deletedIds = new Set(result.deletedSampleIds.map(doseEventId));
  if (
    deletedIds.size !== result.deletedSampleIds.length ||
    [...candidateIds].some(id => deletedIds.has(id))
  ) {
    throw new Error(
      'HealthKit returned conflicting medication dose event identifiers.',
    );
  }

  const nextCursor = result.cursor ?? previousCursor;
  const cursorAdvanced = nextCursor !== null && nextCursor !== previousCursor;
  let upserted = 0;
  let deleted = 0;
  if (candidates.length === 0 && deletedIds.size === 0 && !cursorAdvanced) {
    return { upserted, deleted, cursorAdvanced: false };
  }

  await repository.transaction(async writer => {
    for (const candidate of candidates) {
      const existing = await writer.get('dose_event', candidate.id);
      const next = preserveIngestedAt(existing, candidate);
      if (next !== existing) {
        await writer.put('dose_event', next);
        upserted += 1;
      }
    }
    for (const id of deletedIds) {
      if (await writer.delete('dose_event', id)) deleted += 1;
    }
    if (cursorAdvanced && nextCursor) {
      await writer.putSyncCheckpoint({
        key: DOSE_EVENT_CHECKPOINT_KEY,
        value: nextCursor,
        updatedAt: now(),
      });
    }
  });
  return { upserted, deleted, cursorAdvanced };
}
