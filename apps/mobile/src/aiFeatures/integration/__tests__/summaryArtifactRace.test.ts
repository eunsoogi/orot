import { createManualHistoryRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { reference } from '../../../diseaseHypotheses/taskTestSupport';
import { createSymptomSummaryStorage } from '../../../storage/symptomSummaryStorage';
import { createSummaryArtifactDiscovery } from '../summaryArtifactDiscovery';
import { createSummaryArtifactTool } from '../summaryArtifactTool';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { fingerprint } from '../evidenceUtils';
import { localData } from '../featureServiceFixtures';
import { artifactSource } from '../artifactLineage';

test.each(['identifier scan', 'alias validation'] as const)(
  'does not return a saved summary when its source is deleted during %s',
  async phase => {
    const connection = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(connection.database);
      const history = createManualHistoryRepository(connection.database);
      const entry = await history.create({
        kind: 'note',
        title: 'Synthetic',
        details: 'Synthetic history',
        effectiveDate: { status: 'unknown' },
      });
      const evidence = await history.getEvidence(entry.id);
      const storage = createSymptomSummaryStorage(connection.database);
      await storage.append({
        id: 'saved',
        createdAt: '2035-01-01T00:00:00Z',
        modelName: 'Synthetic',
        modelId: 'model',
        providerId: 'provider',
        inputLineage: 'complete',
        analysis: {
          presentation: 'symptom_summary',
          hypotheses: [
            {
              title: 'Earlier summary',
              summary: 'Synthetic saved interpretation',
              uncertainty: 'Not confirmed',
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
                id: entry.id,
                revision: fingerprint(evidence),
              },
            ],
          },
        ],
      });
      const registry = new LocalEvidenceReferenceRegistry();
      const removeSource = () =>
        connection.database.execute(
          'DELETE FROM manual_history_entries WHERE id = ?',
          [entry.id],
        );
      if (phase === 'alias validation') {
        const validate = registry.revalidateEvidence.bind(registry);
        jest
          .spyOn(registry, 'revalidateEvidence')
          .mockImplementation(async (items, signal) => {
            const valid = await validate(items, signal);
            await removeSource();
            return valid;
          });
      }
      const data = Object.assign(localData([]).data, {
        manualHistory: history,
        findIdentifiers: async () => {
          if (phase === 'identifier scan') await removeSource();
          return [];
        },
        summaryArtifactDiscovery: async (
          currentRegistry: LocalEvidenceReferenceRegistry,
        ) =>
          createSummaryArtifactDiscovery({
            database: connection.database,
            storage,
            data,
            registry: currentRegistry,
          }),
      });
      const tool = createSummaryArtifactTool(data, registry);
      await expect(
        tool.search({
          operationRunId: 'run',
          operationKey: 'search',
          input: { query: 'Synthetic' },
          allowedScope: { sourceKinds: ['generated_artifact'] },
          resultLimit: 1,
          maxPayloadBytes: 20000,
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow();
      expect(artifactSource(registry, 'run', 'e1')).toBeUndefined();
    } finally {
      connection.close();
    }
  },
);
