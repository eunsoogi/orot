import { transcriptSegment, healthObservation } from './localQueryTestSupport';
import { openEncryptedStorage } from '../src/open';
import { CURRENT_SCHEMA_VERSION, runMigrations } from '../src/migrations';
import { sourceDeletionDependencyPredicate } from '../src/sourceDeletionReferences';
import {
  audioSourceRecord,
  createDatabase,
  evidenceSpan,
  hashB,
  options,
} from './sourceEvidenceTestSupport';

test('version 20 refreshes physical source cascades without changing retained evidence', async () => {
  const database = createDatabase();
  try {
    const repo = await openEncryptedStorage(options(database));
    const source = 'target-recording';
    const other = 'other-recording';
    await repo.sourceRecords.create(audioSourceRecord(source));
    await repo.sourceRecords.create({ ...audioSourceRecord(other), contentHash: hashB });
    const target = transcriptSegment(source);
    const unrelated = transcriptSegment(other);
    await repo.transcripts.append([target]);
    await repo.transcripts.append([unrelated]);
    const span = await repo.evidenceSpans.create(
      evidenceSpan('target-span', source, { kind: 'audio_time_range', startMs: 10, endMs: 100 }),
    );
    const timestamp = '2026-01-01T00:00:00.000Z';
    for (const [id, reference] of [
      ['root-health', source],
      ['segment-health', target.id],
      ['bundle-health', target.transcriptId],
      ['unrelated-health', unrelated.transcriptId],
    ] as const) {
      const row = healthObservation(id, 'heart_rate', timestamp);
      await repo.put('health_observation', {
        ...row,
        provenance: { ...row.provenance, sourceRecordIds: [reference] },
      });
    }
    for (const [id, cite] of [
      ['target-question', [span.id]],
      ['other-question', []],
    ] as const) {
      await database.execute(
        'INSERT INTO visit_questions (id, effective_at, recorded_at, ingested_at, payload_json) VALUES (?, ?, ?, ?, ?)',
        [id, timestamp, timestamp, timestamp, JSON.stringify({ evidenceSpanIds: cite })],
      );
      await database.execute(
        'INSERT INTO visit_question_records (id, effective_at, recorded_at, ingested_at, payload_json) VALUES (?, ?, ?, ?, ?)',
        [
          'official-' + id,
          timestamp,
          timestamp,
          timestamp,
          JSON.stringify({ revision: 1, questionId: id }),
        ],
      );
    }
    const trigger = 'source_records_delete_health_observations_dependencies';
    const old = sourceDeletionDependencyPredicate(
      'health_observation',
      'health_observations',
      'OLD.id',
    );
    await database.execute(`DROP TRIGGER ${trigger}`);
    await database.execute(`CREATE TRIGGER ${trigger} BEFORE DELETE ON source_records BEGIN
      INSERT OR IGNORE INTO source_deletion_tombstones (source_id)
        SELECT id FROM health_observations WHERE ${old};
      DELETE FROM health_observations WHERE ${old};
    END`);
    await database.execute('PRAGMA user_version = 20');
    const state = async (tx: Pick<typeof database, 'execute'>) => {
      const ids = async (query: string) =>
        (await tx.execute(query)).rows.map((row) => Object.values(row)[0]);
      return {
        health: await ids('SELECT id FROM health_observations ORDER BY id'),
        sources: await ids('SELECT id FROM source_records ORDER BY id'),
        transcripts: await ids('SELECT id FROM transcript_segments ORDER BY id'),
        official: await ids('SELECT id FROM visit_question_records ORDER BY id'),
        fences: await ids('SELECT source_id FROM source_deletion_tombstones ORDER BY source_id'),
      };
    };
    const before = await state(database);
    expect(CURRENT_SCHEMA_VERSION).toBe(20);
    await runMigrations(database);
    expect(await state(database)).toEqual(before);
    expect((await database.execute('PRAGMA user_version')).rows).toEqual([{ user_version: 20 }]);
    const noWrite = {
      ...database,
      transaction: async () => {
        throw new Error('current trigger definitions must not acquire a writer');
      },
    };
    await runMigrations(noWrite);
    const schema = await database.execute(
      "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?",
      [trigger],
    );
    expect(schema.rows[0]?.sql).toEqual(
      expect.stringContaining('target_transcripts AS MATERIALIZED'),
    );
    await expect(
      database.transaction(async (tx) => {
        await tx.execute('DELETE FROM source_records WHERE id = ?', [source]);
        const inside = await state(tx);
        expect(inside.health).toEqual(['unrelated-health']);
        expect(inside.official).toEqual(['official-other-question']);
        expect(inside.transcripts).toEqual([unrelated.id]);
        expect(inside.fences).toEqual(
          expect.arrayContaining([
            'root-health',
            'segment-health',
            'bundle-health',
            span.id,
            target.id,
            target.transcriptId,
            'target-question',
            'official-target-question',
          ]),
        );
        throw new Error('roll back physical cascade');
      }),
    ).rejects.toThrow('roll back physical cascade');
    expect(await state(database)).toEqual(before);
    expect(await repo.sourceRecords.delete(source)).toBe(true);
    expect(await state(database)).toMatchObject({
      health: ['unrelated-health'],
      official: ['official-other-question'],
      sources: [other],
      transcripts: [unrelated.id],
    });
  } finally {
    await database.closeAsync?.();
  }
});
