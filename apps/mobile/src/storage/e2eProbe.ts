import type { RecordMap, RecordKind } from '@orot/storage';
import {
  getCipherVersion,
  hasDatabaseKey,
  openLocalStorage,
  prepareLegacyStorageForE2e,
  verifyWrongKeyRejected,
} from './secureDatabase';

export type StorageProbeMode = 'fresh' | 'restart' | 'legacy';

const sampleRecord: RecordMap['source_record'] = {
  id: 'storage-e2e-record',
  effectiveAt: '2026-01-01T00:00:00Z',
  recordedAt: '2026-01-01T00:00:00Z',
  ingestedAt: '2026-01-01T00:00:00Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  sourceKind: 'user_note',
  title: 'Synthetic storage probe',
};

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
    await repository.put(kind, sampleRecord);
    return;
  }
  const stored = await repository.get(kind, sampleRecord.id);
  if (!stored || stored.title !== sampleRecord.title) {
    throw new Error('The synthetic storage record was not preserved.');
  }
}
