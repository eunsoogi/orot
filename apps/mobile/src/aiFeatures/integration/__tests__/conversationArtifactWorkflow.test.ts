import { createManualHistoryRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createSymptomSummaryStorage } from '../../../storage/symptomSummaryStorage';
import { createSummaryArtifactDiscovery } from '../summaryArtifactDiscovery';
import type { runRagConversationTurn } from '../../../ragConversation/service';
import type { ArtifactContinuation } from '../../../ragConversation/artifactContinuation';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { createAiFeatureServices } from '../featureServices';
import { reference } from '../../../diseaseHypotheses/taskTestSupport';
import { fingerprint } from '../evidenceUtils';
import {
  apple,
  consent,
  localData,
  selectionStore,
} from '../featureServiceFixtures';

test('conversation workflow can search retained prior answers and continue its own catalog locally', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    await storage.createSession(
      'old-session',
      await storage.currentGeneration(),
    );
    for (const id of ['private-turn-a', 'private-turn-b', 'private-turn-c'])
      await storage.append({
        id,
        sessionId: 'old-session',
        createdAt: '2026-10-05T00:00:00.000Z',
        providerId: 'provider',
        modelId: 'model',
        status: 'complete',
        question: 'question',
        answer: 'synthetic answer',
        sources: [],
        citations: [],
      });
    const summary = createSymptomSummaryStorage(connection.database);
    const history = createManualHistoryRepository(connection.database);
    const entry = await history.create({
      kind: 'note',
      title: 'Synthetic',
      details: 'Synthetic history',
      effectiveDate: { status: 'unknown' },
    });
    const evidence = await history.getEvidence(entry.id);
    await summary.append({
      id: 'summary',
      createdAt: '2026-10-05T00:00:00Z',
      modelName: 'Synthetic',
      modelId: 'model',
      providerId: 'provider',
      inputLineage: 'complete',
      analysis: {
        presentation: 'symptom_summary',
        hypotheses: [
          {
            title: 'Synthetic summary',
            summary: 'synthetic summary',
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
              id: entry.id,
              revision: fingerprint(evidence),
            },
          ],
        },
      ],
    });
    const data = Object.assign(localData([]).data, {
      manualHistory: history,
      summaryArtifactDiscovery: async (
        registry: LocalEvidenceReferenceRegistry,
      ) =>
        createSummaryArtifactDiscovery({
          database: connection.database,
          storage: summary,
          data,
          registry,
        }),
      conversationArtifactDiscovery: async (
        registry: LocalEvidenceReferenceRegistry,
      ) =>
        createConversationArtifactDiscovery({
          database: connection.database,
          storage,
          data,
          registry,
        }),
    });
    const runner = jest.fn(
      async (options: Parameters<typeof runRagConversationTurn>[0]) => {
        const tool = options.workflow.tools.find(
          item => item.id === 'local-conversation-artifacts',
        );
        if (!tool) throw new Error('Conversation search is missing');
        const result = await tool.search({
          operationRunId: 'run',
          operationKey: 'search',
          input: { query: 'synthetic' },
          allowedScope: { sourceKinds: ['generated_artifact'] },
          resultLimit: 1,
          maxPayloadBytes: 20000,
          signal: new AbortController().signal,
        });
        if ('status' in result) throw new Error('Unexpected consent result');
        expect(result.items[0]?.content).toContain('synthetic answer');
        const other = await tool.search({
          operationRunId: 'run',
          operationKey: 'other-search',
          input: { query: 'question' },
          allowedScope: { sourceKinds: ['generated_artifact'] },
          resultLimit: 8,
          maxPayloadBytes: 20000,
          signal: new AbortController().signal,
        });
        if ('status' in other) throw new Error('Unexpected consent result');
        expect(other.coverage[0]?.nextCursor).toBeUndefined();
        const summaryTool = options.workflow.tools.find(
          item => item.id === 'local-generated-artifacts',
        );
        if (!summaryTool) throw new Error('Summary search is missing');
        const last = await summaryTool.search({
          operationRunId: 'run',
          operationKey: 'summary',
          input: { query: 'synthetic' },
          allowedScope: { sourceKinds: ['generated_artifact'] },
          resultLimit: 8,
          maxPayloadBytes: 20000,
          signal: new AbortController().signal,
        });
        if ('status' in last) throw new Error('Unexpected consent result');
        expect(last.coverage[0]?.nextCursor).toBeUndefined();
        return {
          status: 'answer' as const,
          answer: 'Synthetic test answer',
          citations: [result.items[0]!],
        };
      },
    );
    const services = createAiFeatureServices(consent, {
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
    let saved: ArtifactContinuation | null = null;
    await services.sendRagMessage('과거 답변을 찾아 주세요', [], undefined, {
      conversationScope: 'new-session',
      onArtifactContinuation: value => {
        saved = value;
      },
    });
    if (runner.mock.results[0]?.type === 'return')
      await runner.mock.results[0].value;
    expect(saved).toMatchObject({
      query: 'synthetic',
      catalog: 'conversation',
    });
    const continuation = saved as ArtifactContinuation | null;
    const next = await services.sendRagMessage('계속', [], undefined, {
      conversationScope: 'new-session',
      artifactContinuation: continuation,
    });
    expect(next.status).toBe('answer');
    if (next.status !== 'answer')
      throw new Error('Missing continuation answer');
    expect(next.citations.length).toBeGreaterThan(0);
    const source = await services.readSource(
      next.citations[0]!,
      new AbortController().signal,
    );
    expect(source.status).toBe('available');
    if (source.status !== 'available') throw new Error('Missing source');
    expect(source.document.sourceKind).toBe('generated_artifact');
    expect(
      'conversation' in source.document && source.document.conversation.answer,
    ).toBe('synthetic answer');
    expect(runner).toHaveBeenCalledTimes(1);
  } finally {
    connection.close();
  }
});
