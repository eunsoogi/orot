import { localQueryTimestampKey } from '@orot/storage';
import { transcriptSegment } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import {
  healthContextFixture,
  window,
} from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { writeAgentMemoryDeletionMarkers } from '../agentMemoryDeletionMarkers';
import { periodRemovalIndexDefinitions } from '../periodRemovalIndexes';
import { setupResearchInputs } from '../researchArtifactInputs';
import { setupSummaryPeriods } from '../symptomSummaryPeriods';
import { setupVisitQuestionPeriods } from '../visitQuestionPeriods';

test.each(['stock', 'stale'] as const)(
  'research, summary and Visit marker cleanup preserve ownership and rollback: %s',
  async index => {
    const root = 'synthetic-recording';
    const f = await healthContextFixture(root);
    const { database } = f;
    try {
      await database.execute('PRAGMA recursive_triggers = ON');
      const segment = transcriptSegment(root);
      await f.repository.transcripts.append([segment]);
      await database.execute(
        "UPDATE health_observations SET payload_json = json_set(payload_json, '$.provenance.sourceRecordIds', json(?)) WHERE id = ?",
        [JSON.stringify([segment.transcriptId]), f.inside.id],
      );
      const singleton = periodRemovalIndexDefinitions(
        'health_observations',
      ).find(entry => entry.name.endsWith('_period_singleton'))!;
      if (index === 'stale') {
        await database.execute(`DROP INDEX ${singleton.name}`);
        await database.execute(
          `CREATE INDEX ${singleton.name} ON health_observations(id)`,
        );
      }
      await database.transaction(async tx => {
        await tx.execute(
          'CREATE TABLE research_artifacts (id INTEGER PRIMARY KEY AUTOINCREMENT, snapshot_json TEXT NOT NULL, search_text TEXT NOT NULL)',
        );
        await setupResearchInputs(tx);
        await tx.execute(
          'CREATE TABLE IF NOT EXISTS symptom_summary_runs (id TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL, model_name TEXT NOT NULL, result_json TEXT NOT NULL)',
        );
        await setupSummaryPeriods(tx);
        await setupVisitQuestionPeriods(tx);
      });
      const triggerNames = [
        'research_agent_memory_removed_sources_removed',
        'summary_period_logical_health_observations_agent_memory_removed_sources',
        'visit_question_period_logical_health_observations_agent_memory_removed_sources',
      ];
      const { rows: ddl } = await database.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name IN (?, ?)",
        triggerNames,
      );
      expect(ddl).toHaveLength(3);
      for (const row of ddl) {
        expect(
          /roots CROSS JOIN health_observations h/u.test(String(row.sql)),
        ).toBe(index === 'stock');
      }
      const bounds = [
        localQueryTimestampKey(window.fromInclusive),
        localQueryTimestampKey(window.toExclusive),
      ];
      for (const [id, topic] of [
        [1, 'measurements'],
        [2, 'activity'],
      ] as const) {
        await database.execute(
          'INSERT INTO research_artifacts (id, snapshot_json, search_text) VALUES (?, ?, ?)',
          [id, '{}', ''],
        );
        await database.execute(
          'INSERT INTO research_artifact_periods (artifact_id, topic, from_key, to_key) VALUES (?, ?, ?, ?)',
          [id, topic, ...bounds],
        );
      }
      for (const [id, topic, content] of [
        ['matching', 'measurements', '{"inputLineage":"complete"}'],
        ['unrelated', 'activity', '{"inputLineage":"complete"}'],
        ['legacy', 'measurements', '{}'],
      ]) {
        await database.execute(
          'INSERT INTO symptom_summary_runs (id, created_at, model_name, result_json) VALUES (?, ?, ?, ?)',
          [id, window.fromInclusive, 'Synthetic', content],
        );
        await database.execute(
          'INSERT INTO symptom_summary_periods (summary_id, topic, from_key, to_key) VALUES (?, ?, ?, ?)',
          [id, topic, ...bounds],
        );
      }
      for (const [id, topic] of [
        ['visit-matching', 'measurements'],
        ['visit-unrelated', 'activity'],
      ]) {
        const stamp = [
          window.fromInclusive,
          window.fromInclusive,
          window.fromInclusive,
        ];
        await database.execute(
          'INSERT INTO visit_questions (id, effective_at, recorded_at, ingested_at, payload_json) VALUES (?, ?, ?, ?, ?)',
          [id, ...stamp, '{}'],
        );
        await database.execute(
          'INSERT INTO visit_question_periods (question_id, topic, from_key, to_key, dependency_id) VALUES (?, ?, ?, ?, ?)',
          [id, topic, ...bounds, 'dependency-' + id],
        );
        await database.execute(
          'INSERT INTO visit_question_records (id, effective_at, recorded_at, ingested_at, payload_json) VALUES (?, ?, ?, ?, ?)',
          [
            'official-' + id,
            ...stamp,
            JSON.stringify({
              revision: 1,
              questionId: id,
              questionSources: [
                { healthContextSources: [{ scope: { topic, window } }] },
              ],
            }),
          ],
        );
      }
      const read = async (tx: Pick<typeof database, 'execute'>) => ({
        research: (
          await tx.execute('SELECT id FROM research_artifacts ORDER BY id')
        ).rows.map(row => row.id),
        summaries: (
          await tx.execute('SELECT id FROM symptom_summary_runs ORDER BY id')
        ).rows.map(row => row.id),
        visit: (
          await tx.execute('SELECT id FROM visit_questions ORDER BY id')
        ).rows.map(row => row.id),
        officialVisit: (
          await tx.execute('SELECT id FROM visit_question_records ORDER BY id')
        ).rows.map(row => row.id),
        fences: (
          await tx.execute(
            'SELECT source_id FROM agent_memory_removed_sources ORDER BY source_id',
          )
        ).rows.map(row => row.source_id),
      });
      const before = await read(database);
      expect(before.research).toEqual([1, 2]);
      expect(before.visit).toEqual(['visit-matching', 'visit-unrelated']);
      expect(before.officialVisit).toEqual([
        'official-visit-matching',
        'official-visit-unrelated',
      ]);
      expect(before.summaries).toEqual(['legacy', 'matching', 'unrelated']);
      await expect(
        database.transaction(async tx => {
          await writeAgentMemoryDeletionMarkers(
            tx,
            new Set([f.inside.id]),
            new Map([[f.inside.id, ['symptom_entry']]]),
          );
          const wrongKind = await read(tx);
          expect(wrongKind.research).toEqual(before.research);
          expect(wrongKind.summaries).toEqual(before.summaries);
          expect(wrongKind.visit).toEqual(before.visit);
          expect(wrongKind.officialVisit).toEqual(before.officialVisit);
          await writeAgentMemoryDeletionMarkers(
            tx,
            new Set([root]),
            new Map([[root, ['source_record']]]),
          );
          const match = await read(tx);
          expect(match.research).toEqual([2]);
          expect(match.summaries).toEqual(['legacy', 'unrelated']);
          expect(match.visit).toEqual(['visit-unrelated']);
          expect(match.officialVisit).toEqual(['official-visit-unrelated']);
          expect(match.fences).toContain('dependency-visit-matching');
          expect(match.fences).not.toContain('dependency-visit-unrelated');
          expect(match.fences).toEqual(
            expect.arrayContaining([f.inside.id, root]),
          );
          throw new Error('fixture rollback');
        }),
      ).rejects.toThrow('fixture rollback');
      expect(await read(database)).toEqual(before);
    } finally {
      f.close();
    }
  },
);
