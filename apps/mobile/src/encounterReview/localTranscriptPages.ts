import { TranscriptEvidenceSegmentSchema } from '@orot/domain';
import { requireLiveCheckpointSource } from '@orot/storage';
import type { SqlDatabase } from '@orot/storage';
import { acquireIndependentReadEpoch } from '../storage/protectedReadEpoch';
import { watchEncounterNativeAdmission } from './nativeAdmission';
import { currentEncounterTranscriptPageSql } from '../agent/encounter/currentTranscriptPageSql';

const PAGE_SIZE = 16;
type NativeProtection = Parameters<typeof watchEncounterNativeAdmission>[0];

function unavailable(): never {
  throw new Error('The selected recording is no longer admissible.');
}

/**
 * Private read-only substrate, not an enabled generation or checkpoint route.
 * A caller must collect a complete review under this same live operation and
 * reprove admission at dispatch and immediately before any result publication.
 */
export async function openLocalTranscriptPages(input: {
  database: SqlDatabase;
  sourceId: string;
  signal: AbortSignal;
  native: NativeProtection;
  ownerCurrent: () => boolean;
}) {
  const { database, sourceId } = input;
  const epoch = acquireIndependentReadEpoch(database);
  if (!epoch) unavailable();
  const lease = watchEncounterNativeAdmission(
    input.native,
    input.signal,
    () => epoch.current() && input.ownerCurrent(),
  );
  if (!lease) {
    epoch.dispose();
    unavailable();
  }

  let disposed = false;
  let stopBeforeDispatch: (() => void) | undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    stopBeforeDispatch?.();
    lease.signal.removeEventListener('abort', dispose);
    try {
      lease.dispose();
    } finally {
      epoch.dispose();
    }
  };
  lease.signal.addEventListener('abort', dispose, { once: true });
  const dataVersion = async () =>
    (await database.execute('PRAGMA data_version')).rows[0]?.data_version;
  let initialVersion: number;
  try {
    // Retire already-issued pages before dispatching a same-owner mutation,
    // rather than waiting for the consumer to poll the epoch again.
    stopBeforeDispatch = epoch.beforeDispatch(() => {
      try {
        dispose();
      } catch {
        // The lease is already aborted and the epoch released even if a
        // native unsubscribe fails. Do not block the unrelated mutation.
      }
    });
    if (!stopBeforeDispatch) unavailable();
    if (!(await lease.confirm())) unavailable();
    const version = await dataVersion();
    if (typeof version !== 'number' || !(await lease.confirm())) unavailable();
    initialVersion = version;
  } catch (error) {
    dispose();
    throw error;
  }
  const confirm = async () => {
    try {
      if (
        (await lease.confirm()) &&
        (await dataVersion()) === initialVersion &&
        (await lease.confirm())
      )
        return true;
    } catch {
      // A failed SQLite witness cannot make a page current.
    }
    dispose();
    return false;
  };
  let afterOrdinal = -1;
  let afterId = '';
  let done = false;
  let reading = false;
  return {
    signal: lease.signal,
    confirm,
    dispose,
    async next() {
      if (reading) throw new Error('A transcript page is already being read.');
      reading = true;
      try {
        if (!(await confirm())) unavailable();
        if (done) return null;
        await requireLiveCheckpointSource(database, sourceId);
        const source = await database.execute(
          "SELECT 1 FROM source_records WHERE id = ? AND json_extract(payload_json, '$.sourceKind') = 'audio_recording'",
          [sourceId],
        );
        if (!source.rows.length || !(await confirm())) unavailable();
        const result = await database.execute(
          currentEncounterTranscriptPageSql,
          [sourceId, afterOrdinal, afterId, PAGE_SIZE + 1],
        );
        const segments = result.rows.slice(0, PAGE_SIZE).map(row => {
          const segment = TranscriptEvidenceSegmentSchema.parse(
            JSON.parse(String(row.payload_json)),
          );
          if (segment.recordingSourceId !== sourceId) unavailable();
          return segment;
        });
        if (!(await confirm())) unavailable();
        const last = segments.at(-1);
        if (last) {
          afterOrdinal = last.segmentOrdinal;
          afterId = last.id;
        }
        done = result.rows.length <= PAGE_SIZE;
        return segments.length ? { segments, done } : null;
      } catch (error) {
        dispose();
        throw error;
      } finally {
        reading = false;
      }
    },
  };
}
