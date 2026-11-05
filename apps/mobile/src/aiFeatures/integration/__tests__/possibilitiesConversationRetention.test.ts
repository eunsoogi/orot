import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationSessions } from '../../../ragConversation/conversationSessions';
import type { runRagConversationTurn } from '../../../ragConversation/service';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { createAiFeatureServices } from '../featureServices';
import {
  apple,
  consent,
  localData,
  selectionStore,
} from '../featureServiceFixtures';

test('retains follow-up lineage and restores the exploration intent from SQLite', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-possibilities-'));
  const path = join(directory, 'records.sqlite');
  let connection = openSqliteTestDatabase(path);
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    const data = Object.assign(localData([]).data, {
      openConversationArtifactStorage: async () => storage,
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
    let invalidateSession: string | undefined;
    const requests: Parameters<typeof runRagConversationTurn>[0][] = [];
    const runner = jest.fn(
      async (
        options: Parameters<typeof runRagConversationTurn>[0],
        invocation?: Parameters<typeof runRagConversationTurn>[1],
      ) => {
        requests.push(options);
        if (invalidateSession) {
          expect(invocation?.onTaskStreamEvent).toBeUndefined();
          const version = await storage.hideSession(invalidateSession);
          if (version !== null)
            await storage.finalizeHiddenSession(invalidateSession, version);
        }
        options.onValidatedEvidence?.([]);
        return {
          status: 'answer' as const,
          answer: '언제부터 시작됐나요?',
          citations: [],
        };
      },
    ) as unknown as typeof runRagConversationTurn;
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
    const options = services.conversationSessionOptions();
    const sessions = createConversationSessions(options);
    const context = { intent: 'possibilities' as const, entryKey: 'entry' };
    const send = (
      question: string,
      history: Parameters<typeof services.sendRagMessage>[1],
      signal?: AbortSignal,
      observer?: Parameters<typeof services.sendRagMessage>[3],
    ) => services.sendRagMessage(question, history, signal, observer, context);
    sessions.setDraft(1, '피로의 가능성을 살펴봐 주세요');
    await sessions.send(1, send);
    sessions.setDraft(1, '지난주부터 시작됐어요');
    await sessions.send(1, send);
    expect(requests[1]?.validatedPriorTurns).toEqual([
      {
        question: '피로의 가능성을 살펴봐 주세요',
        answer: expect.stringContaining('언제부터 시작됐나요?'),
      },
    ]);
    const sessionId = options.retention!.activeIdentity(1)!;
    const saved = await storage.list(sessionId);
    expect(saved.items).toHaveLength(2);
    const turns = await Promise.all(
      saved.items.map(item => storage.read(item.id)),
    );
    const followup = turns.find(
      turn => turn?.question === '지난주부터 시작됐어요',
    );
    const first = turns.find(
      turn => turn?.question === '피로의 가능성을 살펴봐 주세요',
    );
    expect(followup?.entryIntent).toBe('possibilities');
    expect(first).toBeTruthy();
    expect(followup?.priorDialogue?.[0]?.question).toBe(
      '피로의 가능성을 살펴봐 주세요',
    );
    const restored = await options.restoreSession!(
      sessionId,
      new AbortController().signal,
    );
    expect(restored.map(turn => turn.question)).toEqual([
      '피로의 가능성을 살펴봐 주세요',
      '지난주부터 시작됐어요',
    ]);
    expect(restored.every(turn => turn.entryIntent === 'possibilities')).toBe(
      true,
    );
    // A long chat must not accumulate an unbounded recursive parent chain.
    for (let index = 0; index < 16; index++) {
      sessions.setDraft(1, `추가 답변 ${index}`);
      await sessions.send(1, send);
    }
    expect((await storage.list(sessionId)).items).toHaveLength(18);
    invalidateSession = sessionId;
    sessions.setDraft(1, '다른 기록과 비교해 주세요');
    await sessions.send(1, send);
    expect(
      sessions
        .getSnapshot()
        .sessions[0]?.messages.filter(message => message.role === 'assistant'),
    ).toHaveLength(18);
    expect(await storage.read(followup!.id)).toBeNull();
    sessions.dispose();
    connection.close();
    connection = openSqliteTestDatabase(path);
    const reopened = createConversationArtifactStorage(connection.database);
    expect(await reopened.read(followup!.id)).toBeNull();
    expect((await reopened.list(sessionId)).items).toEqual([]);
  } finally {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
