import type { SqlDatabase } from '../src';
import { createDatabase } from './storageTestDatabase';

export { createDatabase };

export const recordedAt = '2026-09-15T10:20:00Z';
export const sampleRecord = {
  id: 'synthetic-existing-record',
  effectiveAt: recordedAt,
  recordedAt,
  ingestedAt: recordedAt,
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  sourceKind: 'user_note',
  title: 'Synthetic existing record',
};

export function createOptions(database: SqlDatabase) {
  return {
    name: 'orot-test.db',
    keyStore: {
      async getSecret() {
        return 'ef'.repeat(32);
      },
      async setSecret() {},
    },
    randomBytes(target: Uint8Array) {
      target.fill(1);
    },
    openDatabase() {
      return database;
    },
  };
}
