import { providerSuccess } from '@orot/model-runtime';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationSessions } from '../../../ragConversation/conversationSessions';
import { runRagConversationTurn } from '../../../ragConversation/service';
import { createConversationSessionOptions } from '../conversationSessionOptions';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { localData } from '../featureServiceFixtures';
import { createRagConversationService } from '../ragConversationService';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';

test('retains and restores a completed uncited free-text answer through the main session store', async () => {
  const db = openSqliteTestDatabase(':memory:');
  const storage = createConversationArtifactStorage(db.database);
  const fixture = publicEvidenceFixture();
  const answer = '안녕하세요! 오늘은 어떤 이야기를 나누고 싶으세요?';
  const question = '안녕, 그냥 인사하고 싶었어.';
  const generate = jest.fn(async () =>
    providerSuccess({
      text: JSON.stringify({
        type: 'result',
        value: { answerKind: 'conversation', answer },
        citations: [],
      }),
      toolCalls: [],
      finishReason: 'complete' as const,
    }),
  );
  const selected = {
    ...fixture.selected,
    provider: {
      ...fixture.selected.provider,
      searchPublicWeb: undefined,
      generate,
      capabilities: {
        ...fixture.selected.provider.capabilities,
        streaming: false,
        structuredOutput: false,
        toolCalling: false,
      },
    },
  };
  const selectedAi = async () => selected;
  const ports = () => {
    const registry = new LocalEvidenceReferenceRegistry();
    const data = {
      ...localData([]).data,
      openConversationArtifactStorage: async () => storage,
      conversationArtifactDiscovery: async () =>
        createConversationArtifactDiscovery({
          database: db.database,
          storage,
          registry,
          data,
        }),
    };
    const loadLocalData = async () => data;
    const options = createConversationSessionOptions({
      selectedAi,
      registry,
      loadLocalData,
    });
    return { registry, loadLocalData, options };
  };
  const current = ports();
  const sessions = createConversationSessions(current.options);
  try {
    await runMigrations(db.database);
    await sessions.synchronizeModel();
    const id = sessions.getSnapshot().activeId;
    const send = createRagConversationService({
      consent: fixture.consent,
      queryConsent: { authorize: async () => 'authorized' },
      externalEvidence: { search: jest.fn() },
      ...current,
      selectedAi,
      ragRunner: runRagConversationTurn,
    });
    await sessions.sendPrompt(id, question, send);
    const session = sessions
      .getSnapshot()
      .sessions.find(item => item.id === id)!;
    const retained = session.messages.find(
      message =>
        message.role === 'assistant' && message.content.includes(answer),
    );
    expect(retained?.retainedTurnId).toEqual(expect.any(String));
    expect(session.error).toBe('');
    expect(await storage.read(retained!.retainedTurnId!)).toMatchObject({
      answer: retained!.content,
      question,
      citations: [],
      sources: [],
      status: 'complete',
    });
    const next = createConversationSessions(ports().options);
    try {
      await next.synchronizeModel();
      const cold = next
        .getSnapshot()
        .sessions.find(item => item.id === next.getSnapshot().activeId)!;
      expect(cold.savedHistoryDisplay?.map(item => item.row)).toEqual([
        expect.objectContaining({
          kind: 'answer',
          id: retained!.retainedTurnId,
          question,
          answer: retained!.content,
        }),
      ]);
      expect(generate).toHaveBeenCalled();
      expect(fixture.search).not.toHaveBeenCalled();
    } finally {
      next.dispose();
    }
  } finally {
    sessions.dispose();
    db.close();
  }
});
