import type { RecordMap, RecordKind } from '@orot/storage';
import {
  getCipherVersion,
  hasDatabaseKey,
  openLocalStorage,
  prepareLegacyStorageForE2e,
  verifyWrongKeyRejected,
} from './secureDatabase';

export type StorageProbeMode = 'fresh' | 'restart' | 'legacy';

const sampleRecord = {
  id: 'storage-e2e-record',
  effectiveAt: '2026-01-01T00:00:00Z',
  recordedAt: '2026-01-01T00:00:00Z',
  ingestedAt: '2026-01-01T00:00:00Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  sourceKind: 'user_note',
  title: 'Synthetic storage probe',
  contentHash: 'sha256:' + 'c'.repeat(64),
} satisfies RecordMap['source_record'];

const sampleEvidenceSpan = {
  id: 'storage-e2e-evidence',
  effectiveAt: '2026-01-01T00:00:00Z',
  recordedAt: '2026-01-01T00:00:00Z',
  ingestedAt: '2026-01-01T00:00:00Z',
  provenance: { origin: 'imported', sourceRecordIds: [sampleRecord.id] },
  reviewState: { status: 'unreviewed' },
  sourceRecordId: sampleRecord.id,
  text: 'Synthetic storage evidence excerpt.',
  locator: { kind: 'text_range', startOffset: 0, endOffset: 35 },
} satisfies RecordMap['evidence_span'];

export async function runStorageProbe(mode: StorageProbeMode): Promise<void> {
  if (mode === 'legacy') await prepareLegacyStorageForE2e(sampleRecord);
  const repository = await openLocalStorage();
  const cipherVersion = await getCipherVersion();
  if (!cipherVersion || !(await hasDatabaseKey())) {
    throw new Error('Encrypted storage is unavailable.');
  }
  if (!(await verifyWrongKeyRejected())) {
    throw new Error('The database accepted an incorrect encryption key.');
  }

  const kind: RecordKind = 'source_record';
  if (mode === 'fresh') {
    const stored = await repository.sourceRecords.create(sampleRecord);
    const duplicate = await repository.sourceRecords.create({
      ...sampleRecord,
      id: 'storage-e2e-duplicate',
      title: 'Duplicate content must keep the first source record.',
    });
    if (duplicate.id !== stored.id) {
      throw new Error('Duplicate source content was not resolved deterministically.');
    }
    await repository.evidenceSpans.create(sampleEvidenceSpan);
    return;
  }
  const stored =
    mode === 'legacy'
      ? await repository.get(kind, sampleRecord.id)
      : await repository.sourceRecords.get(sampleRecord.id);
  if (!stored || stored.title !== sampleRecord.title) {
    throw new Error('The synthetic storage record was not preserved.');
  }
  if (mode === 'restart') {
    const spans = await repository.evidenceSpans.listForSourceRecord(sampleRecord.id);
    if (
      spans.length !== 1 ||
      spans[0]?.id !== sampleEvidenceSpan.id ||
      spans[0].locator?.kind !== 'text_range' ||
      spans[0].locator.endOffset !== 35
    ) {
      throw new Error('The synthetic evidence span was not preserved.');
    }
  }
}
