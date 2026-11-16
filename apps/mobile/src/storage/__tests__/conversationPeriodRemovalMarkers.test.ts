import { transcriptSegment } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { isPeriodSummarySource } from '../../diseaseHypotheses/savedSummaries';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { assertPeriodNotRemoved } from '../conversationPeriodRemoval';

const scenarios = [
  'direct',
  'wrong-kind',
  'provenance',
  'segment-root',
  'transcript-root',
  'unrelated',
] as const;

test.each(scenarios)(
  'preserves typed direct and provenance matching: %s',
  async scenario => {
    const f = await healthContextFixture(
      scenario.endsWith('-root') ? 'synthetic-recording' : undefined,
    );
    try {
      await createConversationArtifactStorage(f.database).currentGeneration();
      const source = f.saved.sources.find(isPeriodSummarySource)!;
      const segment = transcriptSegment('synthetic-recording');
      if (scenario.endsWith('-root')) {
        await f.repository.transcripts.append([segment]);
        await f.database.execute(
          "UPDATE health_observations SET payload_json = json_set(payload_json, '$.provenance.sourceRecordIds', json(?)) WHERE id = ?",
          [
            JSON.stringify([
              scenario === 'segment-root' ? segment.id : segment.transcriptId,
            ]),
            f.inside.id,
          ],
        );
      }
      const id =
        scenario === 'direct' || scenario === 'wrong-kind'
          ? f.inside.id
          : scenario === 'provenance'
            ? 'source-healthkit'
            : scenario.endsWith('-root')
              ? segment.recordingSourceId
              : 'unrelated';
      for (const marker of [
        'source_deletion_tombstones',
        'agent_memory_removed_sources',
      ]) {
        await f.database.execute(
          `INSERT INTO ${marker}(source_id) VALUES (?)`,
          [id],
        );
        // Direct identities are typed; provenance links must remain conservative even for another kind.
        await f.database.execute(
          'INSERT INTO typed_deletion_markers(marker_table, source_id, kind) VALUES (?, ?, ?)',
          [
            marker,
            id,
            scenario === 'direct' ? 'health_observation' : 'symptom_entry',
          ],
        );
        const check = assertPeriodNotRemoved(
          {
            execute: async (sql, bindings) => {
              const old = sql.replace(
                /FROM (\(SELECT \? AS topic, \? AS from_key, \? AS to_key\) p) CROSS JOIN (\w+ h) WHERE/,
                'FROM $2 CROSS JOIN $1 WHERE',
              );
              const current = await f.database.execute(sql, bindings);
              const previous = await f.database.execute(old, bindings);
              expect(Boolean(current.rows.length)).toBe(
                Boolean(previous.rows.length),
              );
              return current;
            },
          },
          source,
        );
        if (scenario === 'wrong-kind' || scenario === 'unrelated')
          await expect(check).resolves.toBeUndefined();
        else await expect(check).rejects.toThrow('period source was removed');
        await f.database.execute(`DELETE FROM ${marker} WHERE source_id = ?`, [
          id,
        ]);
        await f.database.execute(
          'DELETE FROM typed_deletion_markers WHERE marker_table = ? AND source_id = ?',
          [marker, id],
        );
      }
    } finally {
      f.close();
    }
  },
);
