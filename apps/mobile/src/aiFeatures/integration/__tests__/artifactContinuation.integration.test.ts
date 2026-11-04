import { createManualHistoryRepository, runMigrations } from '@orot/storage';
import { providerSuccess } from '@orot/model-runtime';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { reference } from '../../../diseaseHypotheses/taskTestSupport';
import { createSymptomSummaryStorage } from '../../../storage/symptomSummaryStorage';
import { createConversationSessions } from '../../../ragConversation/conversationSessions';
import { createAiFeatureServices } from '../featureServices';
import {
  apple,
  consent,
  localData,
  selectionStore,
} from '../featureServiceFixtures';
import { createSummaryArtifactDiscovery } from '../summaryArtifactDiscovery';
import { fingerprint } from '../evidenceUtils';
import type { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import type { AiFeatureLocalData } from '../localData';

test('continues empty pages in the same conversation without sharing its handle or calling the provider again', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const history = createManualHistoryRepository(connection.database);
    const entry = await history.create({
      kind: 'note',
      title: 'Synthetic source',
      details: 'Synthetic record',
      effectiveDate: { status: 'unknown' },
    });
    const evidence = await history.getEvidence(entry.id);
    const storage = createSymptomSummaryStorage(connection.database);
    for (let index = 0; index < 18; index += 1) {
      await storage.append({
        id: `2035-01-01-run-${String(index).padStart(2, '0')}`,
        createdAt: '2035-01-01T00:00:00Z',
        modelName: 'Synthetic',
        modelId: 'model',
        providerId: 'provider',
        analysis: {
          presentation: 'symptom_summary',
          hypotheses: [
            {
              title: 'Saved summary',
              summary:
                index === 0
                  ? 'Needle retained output'
                  : 'Other synthetic output',
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
    }
    const data: AiFeatureLocalData = Object.assign(localData([]).data, {
      manualHistory: history,
      findIdentifiers: async () => [entry.id],
      summaryArtifactDiscovery: async (
        registry: LocalEvidenceReferenceRegistry,
      ) =>
        createSummaryArtifactDiscovery({
          database: connection.database,
          storage,
          data,
          registry,
        }),
    });
    const generate = jest
      .fn()
      .mockResolvedValueOnce(
        providerSuccess({
          text: '',
          toolCalls: [
            {
              id: 'search-1',
              name: 'local-generated-artifacts',
              arguments: { query: 'Needle' },
            },
          ],
          finishReason: 'tool_calls' as const,
        }),
      )
      .mockResolvedValueOnce(
        providerSuccess({
          text: JSON.stringify({
            type: 'result',
            value: { answerKind: 'grounded', answer: '찾지 못했어요.' },
            citations: [],
          }),
          toolCalls: [],
          finishReason: 'complete',
        }),
      );
    const option = {
      ...apple,
      provider: {
        ...apple.provider,
        capabilities: { ...apple.provider.capabilities, toolCalling: true },
        generate,
      },
    };
    const service = createAiFeatureServices(consent, {
      selectedAi: {
        selectionStore: selectionStore({
          providerId: option.provider.id,
          modelId: option.modelId,
        }),
        loadAppleOption: async () => option,
      },
      loadLocalData: async () => data,
    });
    const sessions = createConversationSessions();
    const first = sessions.getSnapshot().activeId;
    sessions.setDraft(first, '예전 Needle 요약을 찾아 주세요');
    await sessions.send(first, service.sendRagMessage);
    expect(
      sessions.getSnapshot().sessions[0]?.artifactContinuation,
    ).toBeTruthy();
    expect(sessions.getSnapshot().sessions[0]?.error).toBe('');
    expect(
      sessions.getSnapshot().sessions[0]?.messages.at(-1)?.content,
    ).toContain('계속 찾아');
    expect(
      sessions.getSnapshot().sessions[0]?.artifactContinuation,
    ).toBeTruthy();
    const providerCalls = generate.mock.calls.length;
    sessions.create();
    const second = sessions.getSnapshot().activeId;
    expect(
      sessions.getSnapshot().sessions.find(item => item.id === second)
        ?.artifactContinuation,
    ).toBeFalsy();
    sessions.select(first);
    sessions.setDraft(first, '계속');
    await sessions.send(first, service.sendRagMessage);
    expect(
      sessions
        .getSnapshot()
        .sessions.find(item => item.id === first)
        ?.messages.at(-1)?.content,
    ).toContain('계속 찾아');
    sessions.setDraft(first, '계속');
    await sessions.send(first, service.sendRagMessage);
    const last = sessions
      .getSnapshot()
      .sessions.find(item => item.id === first)
      ?.messages.at(-1);
    expect(last?.content).not.toContain('Needle retained output');
    expect(JSON.stringify(last)).not.toContain('Needle retained output');
    expect(last?.content).toContain('독립적으로 확인된 의료 사실은 아니');
    const citation = last?.citations?.[0];
    expect(citation).toBeDefined();
    const source = await service.readSource(
      citation!,
      new AbortController().signal,
    );
    expect(source.status).toBe('available');
    if (
      source.status !== 'available' ||
      source.document.sourceKind !== 'generated_artifact'
    )
      throw new Error('Expected generated artifact');
    expect(source.document.analysis.hypotheses[0]?.summary).toBe(
      'Needle retained output',
    );
    expect(generate).toHaveBeenCalledTimes(providerCalls);
    await history.delete(entry.id);
    expect(
      (await service.readSource(citation!, new AbortController().signal))
        .status,
    ).toBe('missing');
    generate.mockResolvedValueOnce(
      providerSuccess({
        text: JSON.stringify({
          type: 'result',
          value: { answerKind: 'conversation', answer: '네, 말씀해 주세요.' },
          citations: [],
        }),
        toolCalls: [],
        finishReason: 'complete',
      }),
    );
    sessions.setDraft(first, '안녕하세요');
    await sessions.send(first, service.sendRagMessage);
    expect(generate).toHaveBeenCalledTimes(providerCalls + 1);
    const providerRequest = generate.mock.calls.at(-1)?.[0];
    expect(JSON.stringify(providerRequest)).not.toContain(
      'Needle retained output',
    );
    expect(JSON.stringify(providerRequest)).not.toContain('Synthetic record');
    sessions.dispose();
  } finally {
    connection.close();
  }
});
