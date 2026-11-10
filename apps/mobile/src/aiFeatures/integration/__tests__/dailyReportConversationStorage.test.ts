import { HealthObservationSchema } from '@orot/domain';
import {
  createManualHistoryRepository,
  createRecordRepository,
  runMigrations,
} from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createDailyReportStorage } from '../../../storage/dailyReportStorage';
import { createSymptomSummaryStorage } from '../../../storage/symptomSummaryStorage';
import { createDailyReportCalendarWindow } from '../../../healthEvidence/healthContext/dailyReportWindow';
import { createDailyReportContext } from '../../../healthEvidence/healthContext/dailyReportContext';
import { readHealthContextGeneration } from '../../../healthEvidence/healthContext/generation';
import { createSummaryArtifactDiscovery } from '../summaryArtifactDiscovery';
import { createDailyReportSourceResolver } from '../dailyReportSources';
import { prepareDailyReportConversationEvidence } from '../dailyReportConversationEvidence';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { fingerprint } from '../evidenceUtils';
import type { AiFeatureLocalData } from '../localData';
import type { createDailyReportFeature } from '../dailyReportFeature';

test.each(['corrected', 'deleted', 'replaced'] as const)(
  'saved revision resolves cited records and rejects a %s source or revision',
  async change => {
    const connection = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(connection.database);
      const store = createDailyReportStorage(connection.database);
      const calendar = createDailyReportCalendarWindow({
        localDate: '2035-01-01',
        timeZone: 'UTC',
        requestedAt: '2035-01-01T12:00:00Z',
      });
      if (calendar.status !== 'ready') throw new Error('Invalid fixture');
      await store.lookup(calendar.context.identity);
      const makeRecord = (id: string, amount: number) =>
        HealthObservationSchema.parse({
          id,
          effectiveAt: '2035-01-01T01:00:00Z',
          recordedAt: '2035-01-01T01:00:00Z',
          ingestedAt: '2035-01-01T01:00:00Z',
          provenance: { origin: 'user_reported', sourceRecordIds: [] },
          reviewState: { status: 'unreviewed' },
          observationKind: 'measurement',
          concept: 'heart_rate',
          value: { kind: 'quantity', amount, unit: 'count/min' },
        });
      const cited = makeRecord('cited-private', 72);
      const uncited = makeRecord('uncited-private', 93);
      const repository = createRecordRepository(connection.database);
      await repository.put('health_observation', cited);
      await repository.put('health_observation', uncited);
      const context = createDailyReportContext(
        calendar.context,
        {
          revision: 'snapshot',
          ...(await readHealthContextGeneration(connection.database)),
          records: [cited, uncited].map(record => ({
            source: 'manual',
            recordId: record.id,
            revision: fingerprint(record),
            occurrence: { startInclusive: record.effectiveAt! },
            ingestedAt: record.ingestedAt,
          })),
          coverage: [],
        },
        { providerId: 'local', modelId: 'test' },
      );
      const report = {
        schemaVersion: 1 as const,
        identity: context.identity,
        generatedAt: '2035-01-01T12:01:00Z',
        observations: [
          {
            text: 'Synthetic report prose',
            sourceReferences: [{ source: 'manual', recordId: cited.id }],
          },
        ],
        supportedContext: [],
        coverage: [],
        followUpQuestions: [],
      };
      const savedInput = {
        runId: 'daily-one',
        context,
        result: { status: 'completed', report },
        lineage: [cited, uncited].map(record => ({
          source: 'manual',
          recordId: record.id,
          revision: fingerprint(record),
          kind: 'health_observation' as const,
          localId: record.id,
        })),
        mode: { kind: 'initial' as const },
      };
      expect((await store.save(savedInput)).status).toBe('saved');
      const registry = new LocalEvidenceReferenceRegistry();
      const data = {
        repository: {
          readRecord: (kind: 'health_observation', id: string) =>
            repository.get(kind, id),
        },
        loadStaleArtifacts: async () => [],
        loadMemoryRecords: async () => [],
        manualHistory: createManualHistoryRepository(connection.database),
        findIdentifiers: async () => [cited.id, uncited.id],
      } as unknown as AiFeatureLocalData;
      const discovery = createSummaryArtifactDiscovery({
        database: connection.database,
        storage: createSymptomSummaryStorage(connection.database),
        data,
        registry,
      });
      Object.assign(data, { summaryArtifactDiscovery: async () => discovery });
      const resolve = createDailyReportSourceResolver({
        data: async () => data,
        registry,
        report: { lookup: store.lookup } as ReturnType<
          typeof createDailyReportFeature
        >,
      });
      const signal = new AbortController().signal;
      const prepared = await prepareDailyReportConversationEvidence({
        report: { identity: context.identity, runId: 'daily-one', revision: 1 },
        resolve,
        registry,
        loadLocalData: async () => data,
        signal,
      });
      expect(prepared?.items).toHaveLength(1);
      const payload = JSON.stringify(prepared?.items);
      expect(payload).toContain('72');
      expect(payload).not.toContain('93');
      expect(payload).not.toContain('Synthetic report prose');
      expect(payload).not.toContain(cited.id);
      expect(payload).not.toContain(uncited.id);
      expect(await prepared?.isCurrent()).toBe(true);
      if (change === 'corrected')
        await repository.put('health_observation', makeRecord(cited.id, 80));
      else if (change === 'deleted')
        await repository.delete('health_observation', cited.id);
      else
        expect(
          (
            await store.save({
              ...savedInput,
              runId: 'daily-two',
              mode: { kind: 'revise', expectedRunId: 'daily-one' },
            })
          ).status,
        ).toBe('saved');
      expect(await prepared?.isCurrent()).toBe(false);
      expect(
        await prepareDailyReportConversationEvidence({
          report: {
            identity: context.identity,
            runId: 'daily-one',
            revision: 1,
          },
          resolve,
          registry,
          loadLocalData: async () => data,
          signal,
        }),
      ).toBeNull();
    } finally {
      connection.close();
    }
  },
);
