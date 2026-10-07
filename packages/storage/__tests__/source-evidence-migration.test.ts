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
    expect((await database.execute('PRAGMA user_version')).rows[0]?.user_version).toBe(9);
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

  it('replaces the v8 evidence-span cascade so its identity is tombstoned on upgrade', async () => {
    const database = createDatabase();
    await database.execute(
      'CREATE TABLE source_records (id TEXT PRIMARY KEY NOT NULL, effective_at TEXT NOT NULL, recorded_at TEXT NOT NULL, ingested_at TEXT NOT NULL, payload_json TEXT NOT NULL)',
    );
    await database.execute(
      'CREATE TABLE evidence_spans (id TEXT PRIMARY KEY NOT NULL, effective_at TEXT NOT NULL, recorded_at TEXT NOT NULL, ingested_at TEXT NOT NULL, payload_json TEXT NOT NULL)',
    );
    const source = sourceRecord('v8-source');
    const span = evidenceSpan('v8-span', source.id, {
      kind: 'text_range',
      startOffset: 0,
      endOffset: 1,
    });
    await database.execute(
      'INSERT INTO source_records (id, effective_at, recorded_at, ingested_at, payload_json) VALUES (?, ?, ?, ?, ?)',
      [source.id, source.effectiveAt, source.recordedAt, source.ingestedAt, JSON.stringify(source)],
    );
    await database.execute(
      'INSERT INTO evidence_spans (id, effective_at, recorded_at, ingested_at, payload_json) VALUES (?, ?, ?, ?, ?)',
      [span.id, span.effectiveAt, span.recordedAt, span.ingestedAt, JSON.stringify(span)],
    );
    // Version eight already owns this trigger name with a body that deletes spans without fences.
    await database.execute(
      "CREATE TRIGGER source_records_delete_evidence_spans AFTER DELETE ON source_records BEGIN DELETE FROM evidence_spans WHERE json_extract(payload_json, '$.sourceRecordId') = OLD.id; END",
    );
    await database.execute('PRAGMA user_version = 8');

    const repository = await openEncryptedStorage(options(database));
    await repository.sourceRecords.delete(source.id);

    const tombstones = await database.execute(
      'SELECT source_id FROM source_deletion_tombstones ORDER BY source_id',
    );
    expect(tombstones.rows.map((row) => row.source_id)).toContain(span.id);
    await database.closeAsync?.();
  });
});
