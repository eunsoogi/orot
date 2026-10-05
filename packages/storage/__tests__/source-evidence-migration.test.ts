import { describe, expect, it } from '@jest/globals';
import type { EvidenceSpanLocator } from '@orot/domain';
import { openEncryptedStorage } from '../src';
import { createDatabase, evidenceSpan, options, sourceRecord } from './sourceEvidenceTestSupport';

describe('persistent source and evidence repository schema migration', () => {
  it('upgrades schema v1 without rewriting legacy records or losing relationships', async () => {
    const database = createDatabase();
    await database.execute(
      'CREATE TABLE source_records (id TEXT PRIMARY KEY NOT NULL, effective_at TEXT NOT NULL, recorded_at TEXT NOT NULL, ingested_at TEXT NOT NULL, payload_json TEXT NOT NULL CHECK (json_valid(payload_json)))',
    );
    await database.execute(
      'CREATE TABLE evidence_spans (id TEXT PRIMARY KEY NOT NULL, effective_at TEXT NOT NULL, recorded_at TEXT NOT NULL, ingested_at TEXT NOT NULL, payload_json TEXT NOT NULL CHECK (json_valid(payload_json)))',
    );
    const legacySource = { ...sourceRecord('legacy-source') };
    delete (legacySource as { contentHash?: string }).contentHash;
    const legacySpan = {
      ...evidenceSpan('legacy-span', 'legacy-source', {
        kind: 'text_range',
        startOffset: 0,
        endOffset: 1,
      }),
    };
    delete (legacySpan as { locator?: EvidenceSpanLocator }).locator;
    await database.execute(
      'INSERT INTO source_records (id, effective_at, recorded_at, ingested_at, payload_json) VALUES (?, ?, ?, ?, ?)',
      [
        'legacy-source',
        legacySource.effectiveAt,
        legacySource.recordedAt,
        legacySource.ingestedAt,
        JSON.stringify(legacySource),
      ],
    );
    await database.execute(
      'INSERT INTO evidence_spans (id, effective_at, recorded_at, ingested_at, payload_json) VALUES (?, ?, ?, ?, ?)',
      [
        'legacy-span',
        legacySpan.effectiveAt,
        legacySpan.recordedAt,
        legacySpan.ingestedAt,
        JSON.stringify(legacySpan),
      ],
    );
    await database.execute('PRAGMA user_version = 1');

    const repository = await openEncryptedStorage(options(database));
    expect((await database.execute('PRAGMA user_version')).rows[0]?.user_version).toBe(6);
    expect(await repository.get('source_record', 'legacy-source')).toMatchObject({
      id: 'legacy-source',
    });
    expect(await repository.evidenceSpans.get('legacy-span')).toMatchObject({
      sourceRecordId: 'legacy-source',
      text: 'Synthetic excerpt from the original source.',
    });
    expect(await repository.sourceRecords.delete('legacy-source')).toBe(true);
    expect(await repository.evidenceSpans.get('legacy-span')).toBeNull();
    await database.closeAsync?.();
  });
});
