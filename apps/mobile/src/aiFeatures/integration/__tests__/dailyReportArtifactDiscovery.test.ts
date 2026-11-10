import { HealthObservationSchema } from '@orot/domain';
import {
  createManualHistoryRepository,
  createRecordRepository,
  runMigrations,
} from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createDailyReportStorage } from '../../../storage/dailyReportStorage';
import { createSymptomSummaryStorage } from '../../../storage/symptomSummaryStorage';
import { assertConversationSummaryParent } from '../../../storage/conversationSummaryParent';
import { createDailyReportCalendarWindow } from '../../../healthEvidence/healthContext/dailyReportWindow';
import { createDailyReportContext } from '../../../healthEvidence/healthContext/dailyReportContext';
import { readHealthContextGeneration } from '../../../healthEvidence/healthContext/generation';
import { createSummaryArtifactDiscovery } from '../summaryArtifactDiscovery';
import { createSummaryArtifactTool } from '../summaryArtifactTool';
import { captureConversationSources } from '../captureConversationSources';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { fingerprint } from '../evidenceUtils';
import type { AiFeatureLocalData } from '../localData';

test('discovers only the active daily revision and fences corrected or deleted inputs', async () => {
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
    const record = HealthObservationSchema.parse({
      id: 'synthetic-record',
      effectiveAt: '2035-01-01T01:00:00Z',
      recordedAt: '2035-01-01T01:00:00Z',
      ingestedAt: '2035-01-01T01:00:00Z',
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' },
      observationKind: 'measurement',
      concept: 'heart_rate',
      value: { kind: 'quantity', amount: 72, unit: 'count/min' },
    });
    const repository = createRecordRepository(connection.database);
    await repository.put('health_observation', record);
    const revision = fingerprint(record);
    const context = createDailyReportContext(
      calendar.context,
      {
        revision: 'snapshot',
        ...(await readHealthContextGeneration(connection.database)),
        records: [
          {
            source: 'manual',
            recordId: record.id,
            revision,
            occurrence: { startInclusive: record.effectiveAt! },
            ingestedAt: record.ingestedAt,
          },
        ],
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
          text: 'Synthetic daily observation',
          sourceReferences: [{ source: 'manual', recordId: record.id }],
        },
      ],
      supportedContext: [],
      coverage: [],
      followUpQuestions: [],
    };
    const input = {
      runId: 'daily-one',
      context,
      result: { status: 'completed', report },
      lineage: [
        {
          source: 'manual',
          recordId: record.id,
          revision,
          kind: 'health_observation' as const,
          localId: record.id,
        },
      ],
      mode: { kind: 'initial' as const },
    };
    expect((await store.save(input)).status).toBe('saved');
    const data = {
      repository: {
        readRecord: (kind: 'health_observation', id: string) =>
          repository.get(kind, id),
      },
      loadStaleArtifacts: async () => [],
      loadMemoryRecords: async () => [],
      manualHistory: createManualHistoryRepository(connection.database),
    } as unknown as AiFeatureLocalData;
    const registry = new LocalEvidenceReferenceRegistry();
    const discovery = createSummaryArtifactDiscovery({
      database: connection.database,
      storage: createSymptomSummaryStorage(connection.database),
      data,
      registry,
    });
    Object.assign(data, {
      summaryArtifactDiscovery: async () => discovery,
      findIdentifiers: async () => [record.id],
    });
    const first = await discovery.search({
      query: 'Synthetic daily',
      limit: 10,
    });
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({
      type: 'daily_report',
      id: 'daily-one',
      identity: context.identity,
      dailyRevision: 1,
    });
    const toolResult = await createSummaryArtifactTool(data, registry).search({
      operationRunId: 'synthetic',
      operationKey: 'search',
      input: { query: 'Synthetic daily' },
      allowedScope: { sourceKinds: ['generated_artifact'] },
      resultLimit: 8,
      maxPayloadBytes: 20000,
      signal: new AbortController().signal,
    });
    if ('status' in toolResult) throw new Error('Unexpected consent state');
    expect(toolResult.items).toHaveLength(1);
    expect(toolResult.items[0]?.content).toContain(
      'Synthetic daily observation',
    );
    expect(JSON.stringify(toolResult)).not.toContain(record.id);
    const captured = await captureConversationSources(
      toolResult.items,
      registry,
      new AbortController().signal,
    );
    expect(captured.sources[0]).toMatchObject({
      kind: 'generated_summary',
      id: 'daily-one',
    });
    const detail = await discovery.read('daily-one');
    expect(detail?.sources).toHaveLength(1);
    expect(detail?.content.hypotheses[0]?.supportingEvidence).toHaveLength(1);
    expect(
      await discovery.revalidatePage(
        [{ id: 'daily-one', revision: first.items[0]!.revision }],
        new AbortController().signal,
      ),
    ).toBe(true);
    const parentReference = {
      sourceKind: 'generated_artifact' as const,
      sourceId: 'daily-one',
      evidenceId: 'daily-one',
      sourceRevision: first.items[0]!.revision,
      evidenceRevision: first.items[0]!.revision,
      locator: { kind: 'generated_artifact', type: 'daily_report' },
      effectiveTime: null,
      reviewState: 'unreviewed' as const,
    };
    const summaries = createSymptomSummaryStorage(connection.database);
    await summaries.append({
      id: 'derived-summary',
      createdAt: '2035-01-01T12:03:00Z',
      modelName: 'test',
      modelId: 'test',
      providerId: 'local',
      inputLineage: 'complete',
      analysis: {
        presentation: 'symptom_summary',
        hypotheses: [
          {
            title: 'Synthetic',
            summary: 'Derived text',
            uncertainty: '',
            missingData: [],
            supportingEvidence: [parentReference],
            contraryEvidence: [],
          },
        ],
      },
      sources: [
        {
          kind: 'generated_summary',
          id: 'daily-one',
          revision: first.items[0]!.revision,
          reference: parentReference,
        },
      ],
    });
    expect(await summaries.read('derived-summary')).not.toBeNull();
    const parent = {
      kind: 'generated_summary' as const,
      id: 'daily-one',
      revision: first.items[0]!.revision,
      reference: parentReference,
    };
    await expect(
      connection.database.transaction(tx =>
        assertConversationSummaryParent(tx, connection.database, parent),
      ),
    ).resolves.toBeUndefined();
    expect(
      (
        await store.save({
          ...input,
          runId: 'daily-two',
          mode: { kind: 'revise', expectedRunId: 'daily-one' },
        })
      ).status,
    ).toBe('saved');
    expect(await summaries.read('derived-summary')).toBeNull();
    await expect(
      connection.database.transaction(tx =>
        assertConversationSummaryParent(tx, connection.database, parent),
      ),
    ).rejects.toThrow();
    expect(await discovery.read('daily-one')).toBeNull();
    expect(
      (
        await discovery.search({ query: 'Synthetic daily', limit: 10 })
      ).items.map(item => item.id),
    ).toEqual(['daily-two']);
    expect(
      await discovery.revalidatePage(
        [{ id: 'daily-one', revision: first.items[0]!.revision }],
        new AbortController().signal,
      ),
    ).toBe(false);
    await repository.put('health_observation', {
      ...record,
      value: { kind: 'quantity', amount: 80, unit: 'count/min' },
    });
    expect(await discovery.read('daily-two')).toBeNull();
    await repository.delete('health_observation', record.id);
    expect(
      (await discovery.search({ query: 'Synthetic daily', limit: 10 })).items,
    ).toHaveLength(0);
  } finally {
    connection.close();
  }
});
