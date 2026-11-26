import { healthObservation, transcriptSegment } from './localQueryTestSupport';
import { openEncryptedStorage } from '../src/open';
import { periodRemovalIndexDefinitions } from '../src/periodProvenanceIndexes';
import { readSourceDeletionSnapshot } from '../src/sourceDeletionReferences';
import type { SqlDatabase } from '../src/sql';
import { audioSourceRecord, createDatabase, options } from './sourceEvidenceTestSupport';

for (const trusted of [true, false]) {
  test(`source delete rechecks exact owning typed references with trusted indexes=${trusted}`, async () => {
    const database = createDatabase();
    let tracing = false;
    const queries: string[] = [];
    const observed: SqlDatabase = {
      ...database,
      transaction: (work) =>
        database.transaction((tx) =>
          work({
            ...tx,
            execute: (query, values) => {
              if (tracing) queries.push(query);
              return tx.execute(query, values);
            },
          }),
        ),
    };
    try {
      const repository = await openEncryptedStorage(options(observed));
      const root = 'recording';
      await repository.sourceRecords.create(audioSourceRecord(root));
      const segment = transcriptSegment(root);
      await repository.transcripts.append([segment]);
      const indexes = periodRemovalIndexDefinitions('health_observations');
      for (const { sql } of indexes) await database.execute(sql);
      if (!trusted) {
        await database.execute(`DROP INDEX ${indexes[0]!.name}`);
        await database.execute(`CREATE INDEX ${indexes[0]!.name} ON health_observations(id)`);
      }
      const old = await readSourceDeletionSnapshot(database, root, undefined, {
        useIndexedHealthCandidates: true,
      });
      const at = '2026-10-01T01:00:00Z';
      for (const [id, reference] of [
        ['late-source-health', segment.transcriptId],
        ['other-health', 'unrelated'],
      ] as const) {
        const row = healthObservation(id, 'heart_rate', at);
        await repository.put('health_observation', {
          ...row,
          provenance: { ...row.provenance, sourceRecordIds: [reference] },
        });
      }
      expect(old.some((row) => row.id === 'late-source-health')).toBe(false);
      tracing = true;
      await expect(
        repository.sourceRecords.delete(root, async () => {
          throw new Error('forced rollback');
        }),
      ).rejects.toThrow('forced rollback');
      expect(await repository.sourceRecords.get(root)).not.toBeNull();
      expect(await repository.get('health_observation', 'late-source-health')).not.toBeNull();
      expect(
        (await database.execute('SELECT source_id FROM source_deletion_tombstones')).rows,
      ).toEqual([]);
      expect(await repository.sourceRecords.delete(root)).toBe(true);
      tracing = false;
      expect(
        queries.some((query) => query.includes('aliases CROSS JOIN health_observations')),
      ).toBe(trusted);
      expect(await repository.get('health_observation', 'late-source-health')).toBeNull();
      expect(await repository.get('health_observation', 'other-health')).not.toBeNull();
      const marker = await database.execute(
        "SELECT kind FROM typed_deletion_markers WHERE marker_table = 'source_deletion_tombstones' AND source_id = ?",
        ['late-source-health'],
      );
      expect(marker.rows).toEqual([{ kind: 'health_observation' }]);
      expect((await database.execute('SELECT * FROM typed_deletion_write_context')).rows).toEqual(
        [],
      );
    } finally {
      await database.closeAsync?.();
    }
  });
}
