import { createDailyReportIdentity } from '@orot/domain';
import {
  createRecordRepository,
  createManualHistoryRepository,
} from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createDailyReportStorage } from '../../../storage/dailyReportStorage';
import { createSymptomSummaryStorage } from '../../../storage/symptomSummaryStorage';
import { createDailyReportRequests } from '../dailyReportRequests';
import { createConversationDailyReport } from '../conversationDailyReport';
import { createDailyReportSourceResolver } from '../dailyReportSources';
import { createSummaryArtifactDiscovery } from '../summaryArtifactDiscovery';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import type { AiFeatureLocalData } from '../localData';
import type { createDailyReportFeature } from '../dailyReportFeature';
import {
  prepareReportDatabase,
  reportProvider,
  reportService,
  reportObservation,
} from '../testSupport/dailyReportFailureStageFixtures';

// Investigation only: production generation, SQLite, coordinator and source discovery; synthetic model/data.
test.each(['unchanged', 'edited', 'deleted', 'discovery unavailable'] as const)(
  'initial direct report: %s after final save',
  async change => {
    const connection = openSqliteTestDatabase(':memory:');
    try {
      await prepareReportDatabase(connection.database);
      const identity = createDailyReportIdentity('2035-01-01', 'UTC')!;
      const storage = createDailyReportStorage(connection.database);
      const repository = createRecordRepository(connection.database);
      const provider = reportProvider();
      const service = reportService(connection.database, provider);
      const generated: string[] = [];
      const requests = createDailyReportRequests({
        lookup: storage.lookup,
        currentIdentity: () => identity,
        run: async (_identity, mode, signal, observer) => {
          const result = await service({
            timeZone: 'UTC',
            scope: {},
            mode,
            signal,
            observer,
          });
          generated.push(result.status);
          if (change === 'edited')
            await repository.put('health_observation', {
              ...reportObservation,
              value: { kind: 'quantity', amount: 90, unit: 'count/min' },
            });
          if (change === 'deleted')
            await repository.delete('health_observation', reportObservation.id);
          return result;
        },
      });
      const feature = requests as ReturnType<typeof createDailyReportFeature>;
      const registry = new LocalEvidenceReferenceRegistry();
      const data = {
        repository: {
          readRecord: (kind: 'health_observation', id: string) =>
            repository.get(kind, id),
        },
        loadStaleArtifacts: async () => [],
        loadMemoryRecords: async () => [],
        manualHistory: createManualHistoryRepository(connection.database),
      } as unknown as AiFeatureLocalData;
      const discovery = createSummaryArtifactDiscovery({
        database: connection.database,
        storage: createSymptomSummaryStorage(connection.database),
        data,
        registry,
      });
      if (change !== 'discovery unavailable')
        Object.assign(data, {
          summaryArtifactDiscovery: async () => discovery,
        });
      const sources = jest.fn(
        createDailyReportSourceResolver({
          data: async () => data,
          registry,
          report: feature,
        }),
      );
      const run = createConversationDailyReport({ feature, sources, registry });
      const result = await run(
        'Synthetic report request',
        identity,
        new AbortController().signal,
      );
      expect(generated).toEqual(['completed']);
      if (change === 'unchanged') expect(result.status).toBe('answer');
      else
        expect(result).toEqual({ status: 'failure', kind: 'stale_evidence' });
      if (change === 'discovery unavailable') {
        expect((await storage.lookup(identity)).status).toBe('saved');
        expect(await sources.mock.results[0]!.value).toEqual({
          status: 'unavailable',
        });
      }
      if (change === 'edited' || change === 'deleted')
        expect(sources).not.toHaveBeenCalled();
    } finally {
      connection.close();
    }
  },
);
