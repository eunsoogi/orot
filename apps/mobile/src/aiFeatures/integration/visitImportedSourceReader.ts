import { STRUCTURED_RECORD_KINDS } from '@orot/rag';
import type { RecordRepository } from '@orot/storage';
import {
  localEvidenceFingerprint,
  VISIT_QUESTION_RECORD_KINDS,
} from '../../agent/visitQuestions/evidence';
import { readVisitEvidenceSnapshots } from '../../agent/visitQuestions/evidenceSourceSnapshots';
import type { VisitQuestionEvidenceItem } from '../../agent/visitQuestions/taskContract';
import type { AiFeatureLocalData } from './localData';
import type { EvidenceSourceReadResult } from './evidenceRegistry';
import type { LocalHealthEvidenceRecord } from '../../healthEvidence/localEvidenceRepository';

/** External HealthKit samples are provenance, not SQLite source rows. Reuse the
 * visit mapper's exact snapshot contract before retaining the persisted import.
 * This fallback is only called after the selected local source row is absent. */
export async function readImportedVisitSource(
  repository: AiFeatureLocalData['repository'],
  reference: VisitQuestionEvidenceItem,
  signal: AbortSignal,
): Promise<EvidenceSourceReadResult> {
  if (signal.aborted) return { status: 'unavailable' };
  const value = reference.locator;
  const locator =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Readonly<Record<string, unknown>>)
      : undefined;
  if (
    !locator ||
    locator.kind !== 'structured_record' ||
    locator.recordId !== reference.evidenceId
  )
    return { status: 'missing' };
  const kinds = [...new Set(Object.values(VISIT_QUESTION_RECORD_KINDS))].filter(
    kind => (STRUCTURED_RECORD_KINDS as readonly string[]).includes(kind),
  );
  const rows = await Promise.all(
    kinds.map(async kind => {
      const record = await repository.readRecord(
        kind,
        reference.evidenceId,
        signal,
      );
      return record ? { kind, record } : null;
    }),
  );
  const candidates = rows.filter(
    (row): row is NonNullable<typeof row> => row !== null,
  );
  if (signal.aborted) return { status: 'unavailable' };
  // Never choose among colliding table identities or broaden this fallback to manual imports.
  if (candidates.length !== 1)
    return { status: candidates.length ? 'unavailable' : 'missing' };
  const { kind, record } = candidates[0]!;
  if (
    record.provenance.origin !== 'imported' ||
    record.provenance.source?.system !== 'healthkit' ||
    !record.provenance.sourceRecordIds.includes(reference.sourceId)
  )
    return { status: 'missing' };
  const get: RecordRepository['get'] = (recordKind, id) =>
    repository.readRecord(recordKind, id, signal);
  const { evidenceRecord, sourceIds, snapshots } =
    await readVisitEvidenceSnapshots({ get }, kind, {
      evidenceId: reference.evidenceId,
      sourceRecordIds: record.provenance.sourceRecordIds,
      structured: true,
    });
  if (signal.aborted) return { status: 'unavailable' };
  if (
    localEvidenceFingerprint(evidenceRecord) !== reference.evidenceRevision ||
    localEvidenceFingerprint(
      snapshots.map((snapshot, index) => ({
        sourceId: sourceIds[index]!,
        revision: localEvidenceFingerprint(snapshot),
      })),
    ) !== reference.sourceRevision
  )
    return { status: 'changed' };
  const records: LocalHealthEvidenceRecord[] = [
    { kind, record: evidenceRecord } as LocalHealthEvidenceRecord,
  ];
  // Structured snapshots can contain local SourceRecords as well as external sample descriptors.
  for (const snapshot of snapshots) {
    if ('id' in snapshot)
      records.push({
        kind: 'source_record',
        record: snapshot,
      } as LocalHealthEvidenceRecord);
  }
  return {
    status: 'available',
    document: { sourceKind: 'personal_record', records },
  };
}
