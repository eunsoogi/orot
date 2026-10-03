import {
  EvidenceSpanSchema,
  RecordIdSchema,
  SourceContentHashSchema,
  SourceRecordSchema,
} from '@orot/domain';
import type {
  EvidenceSpan,
  EvidenceSpanLocator,
  SourceContentHash,
  SourceRecord,
} from '@orot/domain';
import { decodeStoredRecord, deleteStoredRecord, insertStoredRecord, readStoredRecord, updateStoredRecord } from './recordPersistence';
import type { RecordMap } from './contracts';
import type { SqlDatabase, SqlExecutor } from './sql';

export type HashedSourceRecord = SourceRecord & { contentHash: SourceContentHash };
export type LocatedEvidenceSpan = EvidenceSpan & { locator: EvidenceSpanLocator };

export interface SourceRecordRepository {
  create(record: HashedSourceRecord): Promise<HashedSourceRecord>;
  get(id: string): Promise<SourceRecord | null>;
  findByContentHash(hash: SourceContentHash): Promise<HashedSourceRecord | null>;
  update(record: HashedSourceRecord): Promise<void>;
  delete(id: string): Promise<boolean>;
}

export interface EvidenceSpanRepository {
  create(span: LocatedEvidenceSpan): Promise<LocatedEvidenceSpan>;
  get(id: string): Promise<EvidenceSpan | null>;
  listForSourceRecord(sourceRecordId: string): Promise<EvidenceSpan[]>;
  update(span: LocatedEvidenceSpan): Promise<void>;
  delete(id: string): Promise<boolean>;
}

async function findSourceByHash(
  executor: SqlExecutor,
  hash: SourceContentHash,
): Promise<HashedSourceRecord | null> {
  const result = await executor.execute(
    "SELECT payload_json FROM source_records WHERE json_extract(payload_json, '$.contentHash') = ? LIMIT 1",
    [hash],
  );
  return result.rows.length === 0
    ? null
    : (decodeStoredRecord('source_record', result.rows[0].payload_json) as HashedSourceRecord);
}

function parseHashedSourceRecord(input: HashedSourceRecord): HashedSourceRecord {
  const record = SourceRecordSchema.parse(input);
  if (!record.contentHash) throw new Error('A source content hash is required.');
  return record as HashedSourceRecord;
}

function parseLocatedEvidenceSpan(input: LocatedEvidenceSpan): LocatedEvidenceSpan {
  const span = EvidenceSpanSchema.parse(input);
  if (!span.locator) throw new Error('An evidence locator is required.');
  return span as LocatedEvidenceSpan;
}

async function requireEvidenceSource(executor: SqlExecutor, sourceRecordId: string): Promise<void> {
  if (!(await readStoredRecord(executor, 'source_record', sourceRecordId))) {
    throw new Error('Evidence span source record does not exist.');
  }
}

export function createSourceEvidenceRepositories(database: SqlDatabase): {
  sourceRecords: SourceRecordRepository;
  evidenceSpans: EvidenceSpanRepository;
} {
  const sourceRecords: SourceRecordRepository = {
    async create(input) {
      const record = parseHashedSourceRecord(input);
      let result: HashedSourceRecord | null = null;
      try {
        await database.transaction(async transaction => {
          const existingId = await readStoredRecord(transaction, 'source_record', record.id);
          if (existingId) {
            if (existingId.contentHash === record.contentHash) {
              result = existingId as HashedSourceRecord;
              return;
            }
            throw new Error('Source record ID already exists with different content.');
          }
          const duplicate = await findSourceByHash(transaction, record.contentHash);
          if (duplicate) {
            result = duplicate;
            return;
          }
          await insertStoredRecord(transaction, 'source_record', record);
          result = record;
        });
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('source_records_content_hash_idx')) {
          throw error;
        }
        const duplicate = await findSourceByHash(database, record.contentHash);
        if (duplicate) return duplicate;
        throw error;
      }
      if (!result) throw new Error('Source record creation returned no record.');
      return result;
    },
    get(id) {
      return readStoredRecord(database, 'source_record', RecordIdSchema.parse(id));
    },
    findByContentHash(hash) {
      return findSourceByHash(database, SourceContentHashSchema.parse(hash));
    },
    async update(input) {
      const record = parseHashedSourceRecord(input);
      await database.transaction(async transaction => {
        if (!(await readStoredRecord(transaction, 'source_record', record.id))) {
          throw new Error('Source record does not exist.');
        }
        const duplicate = await findSourceByHash(transaction, record.contentHash);
        if (duplicate && duplicate.id !== record.id) {
          throw new Error('A source record with this content hash already exists.');
        }
        if (!(await updateStoredRecord(transaction, 'source_record', record))) {
          throw new Error('Source record does not exist.');
        }
      });
    },
    async delete(id) {
      let deleted = false;
      await database.transaction(async transaction => {
        deleted = await deleteStoredRecord(transaction, 'source_record', RecordIdSchema.parse(id));
      });
      return deleted;
    },
  };

  const evidenceSpans: EvidenceSpanRepository = {
    async create(input) {
      const span = parseLocatedEvidenceSpan(input);
      await database.transaction(async transaction => {
        await requireEvidenceSource(transaction, span.sourceRecordId);
        if (await readStoredRecord(transaction, 'evidence_span', span.id)) {
          throw new Error('Evidence span ID already exists.');
        }
        await insertStoredRecord(transaction, 'evidence_span', span as RecordMap['evidence_span']);
      });
      return span;
    },
    get(id) {
      return readStoredRecord(database, 'evidence_span', RecordIdSchema.parse(id));
    },
    async listForSourceRecord(sourceRecordId) {
      const id = RecordIdSchema.parse(sourceRecordId);
      const result = await database.execute(
        "SELECT payload_json FROM evidence_spans WHERE json_extract(payload_json, '$.sourceRecordId') = ? ORDER BY id",
        [id],
      );
      return result.rows.map(row => decodeStoredRecord('evidence_span', row.payload_json));
    },
    async update(input) {
      const span = parseLocatedEvidenceSpan(input);
      await database.transaction(async transaction => {
        if (!(await readStoredRecord(transaction, 'evidence_span', span.id))) {
          throw new Error('Evidence span does not exist.');
        }
        await requireEvidenceSource(transaction, span.sourceRecordId);
        if (!(await updateStoredRecord(transaction, 'evidence_span', span as RecordMap['evidence_span']))) {
          throw new Error('Evidence span does not exist.');
        }
      });
    },
    async delete(id) {
      let deleted = false;
      await database.transaction(async transaction => {
        deleted = await deleteStoredRecord(transaction, 'evidence_span', RecordIdSchema.parse(id));
      });
      return deleted;
    },
  };
  return { sourceRecords, evidenceSpans };
}
