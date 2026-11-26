import { localQueryTimestampKey } from '@orot/storage';
import { transcriptSegment } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import {
  healthContextFixture,
  window,
} from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { writeAgentMemoryDeletionMarkers } from '../agentMemoryDeletionMarkers';
import { setupConversationArtifactSchema } from '../conversationArtifactSchema';
import { periodRemovalIndexDefinitions } from '../periodRemovalIndexes';

test.each([
  ['stock', 'singleton'],
  ['stock', 'legacy'],
  ['stale', 'singleton'],
] as const)(
  'logical recording fences preserve typed evidence and rollback: %s / %s',
  async (index, shape) => {
    const root = 'synthetic-recording';
    const f = await healthContextFixture(root);
    const { database } = f;
    const marker = 'agent_memory_removed_sources';
    const trigger = 'conversation_logical_removal_agent_memory_removed_sources';
    const healthTable = 'health_observations';
    const singleton = periodRemovalIndexDefinitions(healthTable).find(
      definition => definition.name.endsWith('_period_singleton'),
    )!;
    try {
      const segment = transcriptSegment(root);
      await f.repository.transcripts.append([segment]);
      // A matching family is supported even in a legacy multi-value contributor.
      await database.execute(
        "UPDATE health_observations SET payload_json = json_set(payload_json, '$.provenance.sourceRecordIds', json(?)) WHERE id = ?",
        [
          JSON.stringify(
            shape === 'legacy'
              ? [segment.transcriptId, 'unrelated-edge']
              : [segment.transcriptId],
          ),
          f.inside.id,
        ],
      );
      if (index === 'stale') {
        await database.execute(`DROP INDEX ${singleton.name}`);
        await database.execute(
          `CREATE INDEX ${singleton.name} ON health_observations(id)`,
        );
      }
      await database.transaction(setupConversationArtifactSchema);
      const ddl = await database.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?",
        [trigger],
      );
      // Other empty families can still take the fast path on a partial downgrade.
      const fastHealth = /roots CROSS JOIN health_observations h/u.test(
        String(ddl.rows[0]?.sql),
      );
      expect(fastHealth).toBe(index === 'stock');
      expect(ddl.rows[0]?.sql).toEqual(
        expect.stringContaining('LEFT JOIN transcript_segments'),
      );
      await database.execute(
        'INSERT INTO conversation_artifact_sessions(id, generation) SELECT ?, generation FROM conversation_artifact_generation WHERE singleton = 1',
        ['fixture-session'],
      );
      for (const [id, topic] of [
        ['matching', 'measurements'],
        ['unrelated', 'activity'],
      ]) {
        await database.execute(
          'INSERT INTO conversation_artifacts(id, session_id, created_at, result_json) VALUES (?, ?, ?, ?)',
          [id, 'fixture-session', window.fromInclusive, '{}'],
        );
        await database.execute(
          'INSERT INTO conversation_artifact_periods (artifact_id, topic, from_key, to_key) VALUES (?, ?, ?, ?)',
          [
            id,
            topic,
            localQueryTimestampKey(window.fromInclusive),
            localQueryTimestampKey(window.toExclusive),
          ],
        );
      }
      const state = async (tx: Pick<typeof database, 'execute'>) => {
        const rows = async (query: string) => (await tx.execute(query)).rows;
        return {
          artifacts: await rows(
            'SELECT id FROM conversation_artifacts ORDER BY id',
          ),
          generation: await rows(
            'SELECT mutations, deletions FROM health_context_generation WHERE singleton = 1',
          ),
          fences: await rows(
            `SELECT source_id FROM ${marker} ORDER BY source_id`,
          ),
          context: await rows('SELECT * FROM typed_deletion_write_context'),
        };
      };
      const before = await state(database);
      await expect(
        database.transaction(async tx => {
          expect(
            await writeAgentMemoryDeletionMarkers(
              tx,
              new Set([f.inside.id, 'absent-source']),
              new Map([
                [f.inside.id, ['symptom_entry']],
                ['absent-source', ['source_record']],
              ]),
            ),
          ).toBe(true);
          const wrongKind = await state(tx);
          expect(wrongKind.artifacts).toEqual(before.artifacts);
          expect(wrongKind.generation).toEqual(before.generation);
          await writeAgentMemoryDeletionMarkers(
            tx,
            new Set([root]),
            new Map([[root, ['source_record']]]),
          );
          const affected = await state(tx);
          expect(affected.artifacts).toEqual([{ id: 'unrelated' }]);
          expect(affected.generation).toEqual([
            {
              mutations: Number(before.generation[0]?.mutations) + 1,
              deletions: Number(before.generation[0]?.deletions) + 1,
            },
          ]);
          expect(affected.fences.map(row => row.source_id)).toEqual(
            ['absent-source', f.inside.id, root].sort(),
          );
          expect(affected.context).toEqual([]);
          // The fence invalidates derived display, not the source row itself.
          expect(
            (
              await tx.execute(
                'SELECT id FROM health_observations WHERE id = ?',
                [f.inside.id],
              )
            ).rows,
          ).toEqual([{ id: f.inside.id }]);
          throw new Error('fixture rollback');
        }),
      ).rejects.toThrow('fixture rollback');
      expect(await state(database)).toEqual(before);
    } finally {
      f.close();
    }
  },
);
