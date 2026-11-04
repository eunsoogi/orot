import { createManualHistoryRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { reference } from '../../../diseaseHypotheses/taskTestSupport';
import { createSymptomSummaryStorage } from '../../../storage/symptomSummaryStorage';
import { createSummaryArtifactDiscovery } from '../summaryArtifactDiscovery';
import { createSummaryArtifactTool } from '../summaryArtifactTool';
import { createArtifactSourceTool } from '../artifactSourceTool';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { fingerprint } from '../evidenceUtils';
import type { AiFeatureLocalData } from '../localData';
import { createAiFeatureServices } from '../featureServices';
import {
  apple,
  consent,
  localData,
  selectionStore,
} from '../featureServiceFixtures';
import type { runRagConversationTurn } from '../../../ragConversation/service';
import { assertArtifactPayloadPaging } from '../testSupport/assertArtifactPayloadPaging';

test('searches retained AI output through scoped opaque references and invalidates it after source deletion', async () => {
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
    for (const id of [
      '2035-01-01-run-a',
      '2035-01-01-run-b',
      '2035-01-01-run-c',
    ]) {
      await storage.append({
        id,
        createdAt: '2035-01-01T00:00:00Z',
        modelName: 'Synthetic',
        modelId: 'model',
        providerId: 'provider',
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
    }
    const registry = new LocalEvidenceReferenceRegistry();
    const data = Object.assign(localData([]).data, {
      manualHistory: history,
      findIdentifiers: async () => [entry.id],
      summaryArtifactDiscovery: async (
        currentRegistry: LocalEvidenceReferenceRegistry,
      ) =>
        createSummaryArtifactDiscovery({
          database: connection.database,
          storage,
          data,
          registry: currentRegistry,
        }),
    }) as AiFeatureLocalData;
    const tool = createSummaryArtifactTool(data, registry);
    const request = {
      operationRunId: 'run',
      operationKey: 'search',
      input: { query: 'Synthetic' },
      allowedScope: { sourceKinds: ['generated_artifact' as const] },
      resultLimit: 1,
      maxPayloadBytes: 20000,
      signal: new AbortController().signal,
    };
    const first = await tool.search(request);
    if ('status' in first) throw new Error('Unexpected consent result');
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({
      sourceKind: 'generated_artifact',
      reviewState: 'unreviewed',
    });
    expect(first.items[0]?.content).toContain('Synthetic saved interpretation');
    expect(first.items[0]?.content).toContain('not independently verified');
    expect(JSON.stringify(first)).not.toContain(entry.id);
    const savedExcerpt = JSON.parse(first.items[0]!.content);
    const sourceId = savedExcerpt.sections[0].supportingSources[0].evidenceId;
    const follow = createArtifactSourceTool('personal_record', data, registry);
    const source = await follow.search({
      ...request,
      input: { evidenceId: sourceId },
      allowedScope: { sourceKinds: ['personal_record'] },
    });
    if ('status' in source) throw new Error('Unexpected consent result');
    expect(source.items[0]?.content).toContain('Synthetic history');
    expect(source.items[0]?.content).not.toContain(entry.id);
    await expect(
      follow.search({
        ...request,
        operationRunId: 'different-run',
        input: { evidenceId: sourceId },
        allowedScope: { sourceKinds: ['personal_record'] },
      }),
    ).rejects.toThrow('unavailable');
    const omittedRegistry = new LocalEvidenceReferenceRegistry();
    const omittedTool = createSummaryArtifactTool(data, omittedRegistry, {
      referenceOnly: true,
    });
    const omitted = await omittedTool.search({
      ...request,
      operationRunId: 'omitted',
      maxPayloadBytes: 2048,
    });
    if ('status' in omitted) throw new Error('Unexpected consent result');
    expect(omitted.items).toHaveLength(1);
    expect(omitted.items[0]?.content).not.toContain('supportingSources');
    await expect(
      createArtifactSourceTool('personal_record', data, omittedRegistry).search(
        {
          ...request,
          operationRunId: 'omitted',
          input: { evidenceId: 'e1' },
          allowedScope: { sourceKinds: ['personal_record'] },
        },
      ),
    ).rejects.toThrow('unavailable');
    await assertArtifactPayloadPaging(data, request);
    const cursor = first.coverage[0]?.nextCursor;
    expect(cursor).toBeDefined();
    const second = await createSummaryArtifactTool(data, registry).search({
      ...request,
      input: { query: 'Synthetic', cursor: cursor! },
    });
    if ('status' in second) throw new Error('Unexpected consent result');
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.evidenceId).not.toBe(first.items[0]?.evidenceId);
    const third = await createSummaryArtifactTool(data, registry).search({
      ...request,
      input: { query: 'Synthetic', cursor: second.coverage[0]!.nextCursor! },
    });
    if ('status' in third) throw new Error('Unexpected consent result');
    expect(third.items).toHaveLength(1);
    expect(third.coverage[0]?.nextCursor).toBeUndefined();
    expect(await registry.revalidateEvidence(first.items, request.signal)).toBe(
      true,
    );
    const runner = jest.fn(
      async (options: Parameters<typeof runRagConversationTurn>[0]) => {
        expect(
          options.workflow.execution.consentScope?.dataCategories,
        ).toContain('generated_artifacts');
        expect(options.workflow.execution.allowedScope.sourceKinds).toContain(
          'generated_artifact',
        );
        const selected = options.workflow.tools.find(
          candidate => candidate.id === 'local-generated-artifacts',
        );
        expect(selected).toBeDefined();
        const found = await selected!.search({
          ...request,
          allowedScope: options.workflow.execution.allowedScope,
        });
        if ('status' in found) throw new Error('Unexpected consent result');
        expect(found.items[0]?.content).toContain(
          'Synthetic saved interpretation',
        );
        return {
          status: 'answer' as const,
          answer: '이전 결과예요.',
          citations: [],
        };
      },
    ) as unknown as typeof runRagConversationTurn;
    const service = createAiFeatureServices(consent, {
      selectedAi: {
        selectionStore: selectionStore({
          providerId: apple.provider.id,
          modelId: apple.modelId,
        }),
        loadAppleOption: async () => apple,
      },
      loadLocalData: async () => data,
      ragRunner: runner,
    });
    expect(
      await service.sendRagMessage('이전 요약을 찾아 주세요.', []),
    ).toMatchObject({ status: 'answer' });
    expect(runner).toHaveBeenCalledTimes(1);
    await connection.database.execute(
      'DELETE FROM symptom_summary_runs WHERE id = ?',
      ['2035-01-01-run-c'],
    );
    await expect(
      follow.search({
        ...request,
        input: { evidenceId: sourceId },
        allowedScope: { sourceKinds: ['personal_record'] },
      }),
    ).rejects.toThrow('changed or is unavailable');
    expect(
      await registry.revalidateEvidence(source.items, request.signal),
    ).toBe(false);
    await history.delete(entry.id);
    await expect(
      follow.search({
        ...request,
        input: { evidenceId: sourceId },
        allowedScope: { sourceKinds: ['personal_record'] },
      }),
    ).rejects.toThrow('changed or is unavailable');
    expect(await registry.revalidateEvidence(first.items, request.signal)).toBe(
      false,
    );
    expect(
      (await registry.readSource(first.items[0]!, request.signal)).status,
    ).toBe('missing');
    await expect(
      tool.search({
        ...request,
        allowedScope: { sourceKinds: ['personal_record'] },
      }),
    ).rejects.toThrow();
  } finally {
    connection.close();
  }
});
