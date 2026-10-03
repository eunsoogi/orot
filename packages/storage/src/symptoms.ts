import { compareTimestamps, SymptomEntryFilterSchema, SymptomEntrySchema } from '@orot/domain';
import type { SymptomEntry, SymptomEntryFilter } from '@orot/domain';
import { decodeStoredRecord, insertStoredRecord, readStoredRecord, updateStoredRecord } from './recordPersistence';
import type { SqlDatabase, SqlExecutor } from './sql';

export type SymptomQuery = SymptomEntryFilter;

export interface SymptomRepository {
  create(entry: SymptomEntry): Promise<SymptomEntry>;
  get(id: string): Promise<SymptomEntry | null>;
  update(entry: SymptomEntry): Promise<SymptomEntry | null>;
  resolve(id: string, resolvedAt: string): Promise<SymptomEntry | null>;
  list(query?: SymptomQuery): Promise<SymptomEntry[]>;
}

function validateQuery(query: SymptomQuery): SymptomQuery {
  return SymptomEntryFilterSchema.parse(query);
}

function validateUserEntered(entry: SymptomEntry): void {
  if (entry.provenance.origin !== 'user_reported' || entry.reviewState.status !== 'unreviewed') {
    throw new Error('Journal symptoms must remain user-entered and unreviewed.');
  }
}

function assertHistoryPreserved(previous: SymptomEntry, next: SymptomEntry): void {
  if (
    previous.id !== next.id ||
    previous.effectiveAt !== next.effectiveAt ||
    previous.recordedAt !== next.recordedAt ||
    previous.ingestedAt !== next.ingestedAt ||
    JSON.stringify(previous.provenance) !== JSON.stringify(next.provenance) ||
    JSON.stringify(previous.reviewState) !== JSON.stringify(next.reviewState)
  ) {
    throw new Error('Symptom history and provenance cannot be rewritten.');
  }
  if (
    previous.status === 'resolved' &&
    (next.status !== 'resolved' || next.resolvedAt !== previous.resolvedAt)
  ) {
    throw new Error('A resolved symptom status and timestamp cannot be rewritten.');
  }
}

async function readAll(executor: SqlExecutor): Promise<SymptomEntry[]> {
  const result = await executor.execute('SELECT payload_json FROM symptom_entries');
  return result.rows.map(row => decodeStoredRecord('symptom_entry', row.payload_json));
}

export function createSymptomRepository(database: SqlDatabase): SymptomRepository {
  return {
    async create(input) {
      if (!Object.hasOwn(input, 'status')) throw new Error('A symptom status is required.');
      const entry = SymptomEntrySchema.parse(input);
      validateUserEntered(entry);
      await database.transaction(transaction => insertStoredRecord(transaction, 'symptom_entry', entry));
      return entry;
    },
    get: id => readStoredRecord(database, 'symptom_entry', id),
    async update(input) {
      if (!Object.hasOwn(input, 'status')) throw new Error('A symptom status is required.');
      const entry = SymptomEntrySchema.parse(input);
      let updated: SymptomEntry | null = null;
      await database.transaction(async transaction => {
        const previous = await readStoredRecord(transaction, 'symptom_entry', entry.id);
        if (!previous) return;
        validateUserEntered(entry);
        assertHistoryPreserved(previous, entry);
        if (!await updateStoredRecord(transaction, 'symptom_entry', entry)) {
          throw new Error('The symptom entry could not be updated.');
        }
        updated = entry;
      });
      return updated;
    },
    async resolve(id, resolvedAt) {
      let resolved: SymptomEntry | null = null;
      await database.transaction(async transaction => {
        const previous = await readStoredRecord(transaction, 'symptom_entry', id);
        if (!previous) return;
        validateUserEntered(previous);
        if (previous.status === 'resolved') {
          throw new Error('A resolved symptom cannot be resolved again.');
        }
        const entry = SymptomEntrySchema.parse({ ...previous, status: 'resolved', resolvedAt });
        assertHistoryPreserved(previous, entry);
        if (!await updateStoredRecord(transaction, 'symptom_entry', entry)) {
          throw new Error('The symptom entry could not be resolved.');
        }
        resolved = entry;
      });
      return resolved;
    },
    async list(input = {}) {
      const query = validateQuery(input);
      const entries = await readAll(database);
      return entries
        .filter(entry => {
          if (query.status && entry.status !== query.status) return false;
          if (query.fromOnsetAt && compareTimestamps(entry.effectiveAt, query.fromOnsetAt) < 0) {
            return false;
          }
          if (
            query.throughOnsetAt &&
            compareTimestamps(entry.effectiveAt, query.throughOnsetAt) > 0
          ) return false;
          return true;
        })
        .sort((left, right) =>
          compareTimestamps(right.effectiveAt, left.effectiveAt) || left.id.localeCompare(right.id),
        );
    },
  };
}
