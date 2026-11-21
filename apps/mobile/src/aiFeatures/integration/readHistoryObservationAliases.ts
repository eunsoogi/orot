import { RecordIdSchema } from '@orot/domain';
import { decodeHealthEvidenceRecord } from '../../healthEvidence/localEvidenceQueries';
import { openOwnedObservationHydration } from '../../healthEvidence/historyObservationHydrationOwner';
import type { ConversationArtifact } from '../../storage/conversationArtifactCodec';
import type { SavedSummarySource } from '../../diseaseHypotheses/savedSummaries';
import type { EvidenceSourceReadResult } from './evidenceRegistry';
import { fingerprint, utf8ByteLength } from './evidenceUtils';

const maxDescriptors = 256;
const maxKeyBytes = 16 * 1024;
const maxRowBytes = 8 * 1024;
export type ObservationHydrationOwner = NonNullable<
  ReturnType<typeof openOwnedObservationHydration>
>;

/** Take one fresh, bounded snapshot solely for first-page alias hydration.
 * Final page authorization and live alias reopening use independent readers. */
export async function readHistoryObservationAliases(
  owner: ObservationHydrationOwner,
  artifact: ConversationArtifact,
) {
  const sources = artifact.sources;
  if (
    !owner.current() ||
    artifact.submittedInput ||
    artifact.dailyReport ||
    artifact.treatmentContext ||
    artifact.visitQuestions !== undefined ||
    artifact.healthSummary !== undefined ||
    artifact.entryIntent !== undefined ||
    sources.length < 2 ||
    sources.length > maxDescriptors
  )
    return undefined;

  const descriptors: {
    source: SavedSummarySource;
    record: { id: string; revision: string };
  }[] = [];
  const ids = new Set<string>();
  for (const source of sources) {
    if (
      'kind' in source ||
      source.reference.sourceKind !== 'personal_record' ||
      source.records.length !== 1
    )
      return undefined;
    const record = source.records[0]!;
    if (
      record.kind !== 'health_observation' ||
      record.id.length > maxKeyBytes ||
      !RecordIdSchema.safeParse(record.id).success
    )
      return undefined;
    descriptors.push({ source, record });
    ids.add(record.id);
  }
  const keys = JSON.stringify([...ids]);
  if (utf8ByteLength(keys) > maxKeyBytes) return undefined;

  const output = new Map<SavedSummarySource, EvidenceSourceReadResult>();
  let oversized = false;
  await owner.database.transaction(async tx => {
    if (!owner.current()) return;
    const { rows } = await tx.execute(
      `SELECT r.id,
        CASE WHEN length(CAST(r.payload_json AS BLOB)) <= ${maxRowBytes} THEN r.payload_json ELSE NULL END AS payload_json,
        length(CAST(r.payload_json AS BLOB)) AS payload_bytes,
        EXISTS (SELECT 1 FROM transcript_artifact_staleness s
          WHERE s.artifact_kind = 'health_observation' AND s.artifact_id = r.id) AS history_alias_stale
      FROM health_observations r WHERE r.id IN (SELECT value FROM json_each(?))`,
      [keys],
    );
    if (!owner.current()) return;
    const byId = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (
        typeof row.id !== 'string' ||
        !ids.has(row.id) ||
        byId.has(row.id) ||
        (row.history_alias_stale !== 0 && row.history_alias_stale !== 1)
      )
        throw new Error(
          'A stored health_observation record could not be read safely.',
        );
      if (
        typeof row.payload_bytes === 'number' &&
        row.payload_bytes > maxRowBytes
      )
        oversized = true;
      byId.set(row.id, row);
    }
    // An oversized payload uses the existing independent strict path if the
    // transaction succeeded. Never retry a transaction or transport failure.
    if (oversized) return;
    for (const { source, record } of descriptors) {
      const row = byId.get(record.id);
      if (!row) {
        output.set(source, { status: 'missing' });
        continue;
      }
      // Preserve normal reader shape/decode errors and choose errors in source order.
      const decoded = decodeHealthEvidenceRecord('health_observation', row);
      output.set(
        source,
        fingerprint(decoded.record) !== record.revision ||
          row.history_alias_stale === 1
          ? { status: 'changed' }
          : {
              status: 'available',
              document: { sourceKind: 'personal_record', records: [decoded] },
            },
      );
    }
  });
  return owner.current() && !oversized ? output : undefined;
}
