import { createManualHistoryRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createSymptomSummaryStorage } from '../../../storage/symptomSummaryStorage';
import { reference } from '../../../diseaseHypotheses/taskTestSupport';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { createSummaryArtifactDiscovery } from '../summaryArtifactDiscovery';
import { createSummaryArtifactTool } from '../summaryArtifactTool';
import { fingerprint } from '../evidenceUtils';
import type { AiFeatureLocalData } from '../localData';
import { createSymptomSummaryPersistence } from '../symptomSummaryPersistence';
import { restoreSymptomSummary } from '../symptomSummarySources';

test('a legacy summary cannot send deleted uncited input through discovery', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const history = createManualHistoryRepository(connection.database);
    const cited = await history.create({
      kind: 'note',
      title: 'Cited',
      details: 'cited',
      effectiveDate: { status: 'unknown' },
    });
    const uncited = await history.create({
      kind: 'note',
      title: 'Uncited',
      details: 'deleted synthetic secret',
      effectiveDate: { status: 'unknown' },
    });
    const storage = createSymptomSummaryStorage(connection.database);
    await storage.append({
      id: 'legacy',
      createdAt: '2035-01-01T00:00:00Z',
      providerId: 'provider',
      modelId: 'model',
      modelName: 'Synthetic',
      analysis: {
        presentation: 'symptom_summary',
        hypotheses: [
          {
            title: 'Summary',
            summary: 'deleted synthetic secret',
            uncertainty: '',
            missingData: [],
            supportingEvidence: [reference],
            contraryEvidence: [],
          },
        ],
      },
      sources: [
        {
          reference,
          records: [
            {
              kind: 'manual_history',
              id: cited.id,
              revision: fingerprint(await history.getEvidence(cited.id)),
            },
          ],
        },
      ],
    });
    await history.delete(uncited.id);
    expect(await storage.read('legacy')).not.toBeNull();
    const registry = new LocalEvidenceReferenceRegistry();
    const data = { manualHistory: history } as AiFeatureLocalData;
    const before = await connection.database.execute(
      'SELECT result_json FROM symptom_summary_runs WHERE id = ?',
      ['legacy'],
    );
    const persistence = createSymptomSummaryPersistence({
      storage: async () => storage,
      data: async () => data,
      registry,
    });
    expect((await persistence.history.list())[0]).toMatchObject({
      id: 'legacy',
      inputLineage: 'unknown',
    });
    expect(await persistence.history.read('legacy')).toBeNull();
    await expect(
      restoreSymptomSummary((await storage.read('legacy'))!, registry, data),
    ).rejects.toThrow();
    const discovery = createSummaryArtifactDiscovery({
      database: connection.database,
      storage,
      data,
      registry,
    });
    expect(
      (await discovery.search({ query: '', limit: 10 })).items[0]?.inputLineage,
    ).toBe('unknown');
    expect(await discovery.read('legacy')).toBeNull();
    const tool = createSummaryArtifactTool(
      {
        ...data,
        summaryArtifactDiscovery: async () => discovery,
      } as AiFeatureLocalData,
      registry,
    );
    const result = await tool.search({
      operationRunId: 'run',
      operationKey: 'search',
      input: { query: 'synthetic' },
      allowedScope: { sourceKinds: ['generated_artifact'] },
      resultLimit: 8,
      maxPayloadBytes: 20000,
      signal: new AbortController().signal,
    });
    expect(JSON.stringify(result)).not.toContain('deleted synthetic secret');
    if ('status' in result) throw new Error('Unexpected consent result');
    expect(result.items).toHaveLength(0);
    expect(result.coverage[0]?.gaps.length).toBeGreaterThan(0);
    expect(result.coverage[0]?.gaps).toContain(
      'Some older saved summaries could not be searched because their original input lineage is unknown. Their content and sources are unavailable for this search.',
    );
    expect(JSON.stringify(result)).not.toContain('legacy');
    const other = await tool.search({
      operationRunId: 'run',
      operationKey: 'search',
      input: { query: 'unrelated term' },
      allowedScope: { sourceKinds: ['generated_artifact'] },
      resultLimit: 8,
      maxPayloadBytes: 20000,
      signal: new AbortController().signal,
    });
    expect(other).toEqual(result);
    expect(
      await connection.database.execute(
        'SELECT result_json FROM symptom_summary_runs WHERE id = ?',
        ['legacy'],
      ),
    ).toEqual(before);
    // Upgrade a trigger left by an older installation before any source writer runs.
    const original = (await storage.read('legacy'))!;
    await storage.append({
      ...original,
      id: 'complete',
      inputLineage: 'complete',
    });
    await connection.database.execute(
      'DROP TRIGGER summary_manual_history_deleted',
    );
    await connection.database.execute(
      "CREATE TRIGGER summary_manual_history_deleted AFTER DELETE ON manual_history_entries BEGIN DELETE FROM symptom_summary_runs WHERE id IN (SELECT summary_id FROM symptom_summary_sources WHERE record_kind = 'manual_history' AND record_id = OLD.id); END",
    );
    const reopened = createSymptomSummaryStorage(connection.database);
    await reopened.list();
    expect(await reopened.read('complete')).not.toBeNull();
    expect(await persistence.history.read('complete')).not.toBeNull();
    expect(await discovery.read('complete')).not.toBeNull();
    await history.delete(cited.id);
    expect(
      await connection.database.execute(
        'SELECT result_json FROM symptom_summary_runs WHERE id = ?',
        ['legacy'],
      ),
    ).toEqual(before);
    expect(await reopened.read('complete')).toBeNull();
    await createSymptomSummaryStorage(connection.database).list();
    expect(
      await connection.database.execute(
        'SELECT result_json FROM symptom_summary_runs WHERE id = ?',
        ['legacy'],
      ),
    ).toEqual(before);
  } finally {
    connection.close();
  }
});
