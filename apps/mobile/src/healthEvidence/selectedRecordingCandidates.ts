import { requireLiveCheckpointSource } from '@orot/storage';
import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import { visitPeriodEvidenceAvailable } from '../storage/visitPeriodEvidencePolicy';
import type { EvidenceCandidateScope } from './evidenceCandidateScope';
import type { LocalEvidenceCandidates } from './evidenceCandidates';
import {
  checkHealthEvidenceAbort,
  decodeHealthEvidenceRecord,
  queryHealthEvidenceRows,
  type LocalHealthEvidenceRecord,
} from './localEvidenceQueries';
import { readRankedEvidencePage } from './rankedEvidencePages';

/** Read one authorized source and only its current ranked transcript rows. */
export async function readSelectedRecordingCandidates(
  database: SqlDatabase,
  query: string,
  scope: EvidenceCandidateScope,
  signal?: AbortSignal,
): Promise<LocalEvidenceCandidates> {
  const sourceId =
    scope.sourceIds?.length === 1 ? scope.sourceIds[0] : undefined;
  if (!sourceId) throw new Error('An exact recording source is required.');
  checkHealthEvidenceAbort(signal);
  let snapshot: LocalEvidenceCandidates | undefined;
  await database.transaction(async tx => {
    await requireLiveCheckpointSource(tx, sourceId);
    const rows = await queryHealthEvidenceRows(
      tx,
      'source_record',
      { kind: 'id', value: sourceId },
      1,
      signal,
    );
    if (!rows[0]) throw new Error('Selected recording is unavailable.');
    const source = decodeHealthEvidenceRecord('source_record', rows[0]);
    if (
      source.kind !== 'source_record' ||
      source.record.sourceKind !== 'audio_recording'
    )
      throw new Error('The selected source is not a recording.');
    const page = await readRankedEvidencePage(tx, 'transcript_segment', query, {
      limit: 8,
      scope,
      signal,
    });
    const candidates = [];
    for (const item of page.records) {
      checkHealthEvidenceAbort(signal);
      if (
        item.kind === 'transcript_segment' &&
        item.record.recordingSourceId === sourceId &&
        (await visitPeriodEvidenceAvailable(tx, item))
      )
        candidates.push(item);
    }
    checkHealthEvidenceAbort(signal);
    snapshot = {
      catalog: {
        inventoryComplete: !page.incomplete,
        availableKinds: candidates.length ? ['transcript_segment'] : [],
        queriedKinds: ['transcript_segment'],
        unsupportedKinds: [],
        truncatedKinds: page.incomplete ? ['transcript_segment'] : [],
        totalRecordCount: candidates.length,
      },
      candidates,
      dependencies: [
        source,
        ...(await readTranscriptProvenance(tx, sourceId, candidates, signal)),
      ],
      hasMoreCandidates: page.nextCursor !== null,
    };
  });
  checkHealthEvidenceAbort(signal);
  if (!snapshot)
    throw new Error('Selected transcript snapshot is unavailable.');
  return snapshot;
}

/** Prior revisions are local provenance only; they are never candidate excerpts. */
async function readTranscriptProvenance(
  tx: SqlExecutor,
  sourceId: string,
  candidates: readonly LocalHealthEvidenceRecord[],
  signal?: AbortSignal,
) {
  const existing = new Set([
    sourceId,
    ...candidates.map(item => item.record.id),
  ]);
  const requested = [
    ...new Set(
      candidates.flatMap(item => [...item.record.provenance.sourceRecordIds]),
    ),
  ].filter(id => !existing.has(id));
  const records: LocalHealthEvidenceRecord[] = [];
  for (let offset = 0; offset < requested.length; offset += 100) {
    checkHealthEvidenceAbort(signal);
    const batch = requested.slice(offset, offset + 100);
    const result = await tx.execute(
      `SELECT id, payload_json,
      length(CAST(payload_json AS BLOB)) AS payload_bytes FROM transcript_segments
      WHERE id IN (${batch.map(() => '?').join(', ')})
      AND json_extract(payload_json, '$.recordingSourceId') = ?`,
      [...batch, sourceId],
    );
    if (result.rows.length !== batch.length)
      throw new Error('Selected transcript provenance is unavailable.');
    for (const row of result.rows)
      records.push(decodeHealthEvidenceRecord('transcript_segment', row));
  }
  return records;
}
