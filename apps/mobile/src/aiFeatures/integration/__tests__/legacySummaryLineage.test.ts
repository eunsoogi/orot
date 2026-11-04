import { createManualHistoryRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createSymptomSummaryStorage } from '../../../storage/symptomSummaryStorage';
import { reference } from '../../../diseaseHypotheses/taskTestSupport';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { createSummaryArtifactDiscovery } from '../summaryArtifactDiscovery';
import { createSummaryArtifactTool } from '../summaryArtifactTool';
import { fingerprint } from '../evidenceUtils';
import type { AiFeatureLocalData } from '../localData';

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
  } finally {
    connection.close();
  }
});
