import { APPLE_PCC_PROVIDER_ID, APPLE_PROVIDER_ID } from '@orot/provider-apple';
import { hasConversationMemoryCommand } from '../../../manualHistory/conversationHistoryIntent';
import { archivedConversationAnswerTarget } from '../../../ragConversation/archivedConversationAnswerTarget';
import { conversationExecutionNative } from '../../../ragConversation/conversationExecutionNative';
import type { ConversationExecutionEvent } from '../../../ragConversation/conversationExecutionLease';
import type { RagConversationObserver } from '../../../ragConversation/conversationObserver';
import type { ConversationSession } from '../../../ragConversation/conversationSessionTypes';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { conversationMutationExecution } from '../conversationMutationExecution';
import type { AiFeatureLocalData } from '../localData';
import { healthContextFixture } from '../testSupport/healthContextPersistenceFixture';
jest.mock('../../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));
const sessionId = 'owned-restored-conversation';
const sourceId = 'latest-visible-ordinary';
const olderId = 'older-prompt-only';
const requestId = 'new-owned-request';
const answer = 'Exact private synthetic archived answer.';
const question = 'Could you keep your preceding reply for later?';
const at = '2026-11-25T00:00:00.000Z';
const arm = { target: 'previous_completed_answer' };
const owner = { id: sessionId, version: 0 };
const row = {
  id: sourceId,
  kind: 'answer' as const,
  createdAt: at,
  question: 'Synthetic example.',
  answer,
};
const operation = {
  operationRunId: 'archived-answer-fixture',
  operationKey: 'selected-answer',
};
function restored(newer?: { partial?: true; directPhoto?: true }) {
  const rows =
    newer?.partial || newer?.directPhoto
      ? [row, { ...row, ...newer, id: 'newer' }]
      : [row];
  const savedHistoryDisplay = rows.map((row, i) => ({
    row,
    questionId: -1 - i * 2,
    answerId: -2 - i * 2,
  }));
  return {
    messages: [],
    savedHistoryDisplay,
  } as unknown as ConversationSession;
}
const modelId = 'fixture-model';
function actionSelection(
  observer: RagConversationObserver,
  data: Pick<AiFeatureLocalData, 'openConversationArtifactStorage'>,
  providerId = APPLE_PROVIDER_ID,
  remoteProcessing = false,
  withProof = true,
) {
  const selected = {
    modelId,
    provider: { id: providerId, capabilities: { toolCalling: true } },
    remoteProcessing,
  };
  return conversationMutationExecution({
    baseExecution: { execution: operation },
    data,
    selected,
    registry: { resolve: () => undefined },
    question,
    history: {
      priorTurns: [],
      references: [],
      historicalDialogueParents: [{ id: olderId, createdAt: at }],
    },
    remoteAnswerMemory: true,
    observer: {
      inputOrigin: 'composer',
      retentionSession: owner,
      retentionRequestId: requestId,
      retainedHistory: [
        { id: olderId, question: 'Unrelated prompt-only row.' },
      ],
      expectedConversationModel: { providerId, modelId },
      templateProposalOwner: withProof
        ? {
            providerId,
            modelId,
            current: () => true,
            recheck: async () => true,
            watch: () => () => {},
          }
        : undefined,
      ...observer,
    },
  } as unknown as Parameters<typeof conversationMutationExecution>[0]);
}
const toolId = 'remember-conversation-answer';
test.each([
  'partial',
  'photo',
  'replacement lease',
  'pending selection',
  'remote subscription',
  'PCC',
  'missing native proof',
] as const)('never substitutes an older prompt-only target after %s', mode => {
  const snapshot = restored({
    partial: mode === 'partial' ? true : undefined,
    directPhoto: mode === 'photo' ? true : undefined,
  });
  let latest = snapshot;
  let lease = owner;
  const archive = archivedConversationAnswerTarget({
    session: snapshot,
    find: () => latest,
    lease: () => lease,
    current: () => true,
  });
  if (mode === 'replacement lease') lease = { ...owner, version: 1 };
  if (mode === 'pending selection')
    latest = { ...snapshot, modelSelectionPending: true };
  const data = { openConversationArtifactStorage: jest.fn() };
  const remote = mode === 'remote subscription' || mode === 'PCC';
  const provider =
    mode === 'PCC'
      ? APPLE_PCC_PROVIDER_ID
      : remote
        ? 'chatgpt-plan:fixture'
        : APPLE_PROVIDER_ID;
  const confirmHistorySave = async () => true;
  const select = (archivedAnswerMemoryTarget: typeof archive) =>
    actionSelection(
      { archivedAnswerMemoryTarget, confirmHistorySave },
      data,
      provider,
      remote,
      mode !== 'missing native proof',
    );
  const offers = (target: typeof archive) =>
    select(target).execution.actions?.some(tool => tool.id === toolId);
  expect(offers(archive)).toBe(false);
  if (mode === 'remote subscription') expect(offers(undefined)).toBe(true);
});
test.each(['save', 'source reproof', 'lock during consent'] as const)(
  'keeps a nonmatching contextual request on its Apple on-device archive: %s',
  async mode => {
    expect(hasConversationMemoryCommand(question)).toBe(false);
    const f = await healthContextFixture();
    const abort = new AbortController();
    const listeners = new Set<(event: ConversationExecutionEvent) => void>();
    jest.mocked(conversationExecutionNative).mockReturnValue({
      bridgeAvailable: true,
      currentPhase: () => 'active',
      begin: async () => false,
      end() {},
      isActive: async () => false,
      protectedDataAvailable: async () => true,
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    });
    try {
      const storage = createConversationArtifactStorage(f.database);
      await storage.createSession(sessionId, await storage.currentGeneration());
      const prior = {
        id: sourceId,
        sessionId,
        sessionVersion: 0,
        createdAt: at,
        question: row.question,
      };
      await storage.startRequest(prior);
      await storage.append({
        ...prior,
        providerId: 'synthetic',
        modelId,
        answer,
        status: 'complete',
        sources: f.saved.sources,
      });
      await storage.startRequest({
        ...prior,
        id: requestId,
        createdAt: '2026-11-25T00:00:01.000Z',
        question,
      });
      const snapshot = restored();
      const archivedAnswerMemoryTarget = archivedConversationAnswerTarget({
        session: snapshot,
        find: () => snapshot,
        lease: () => owner,
        current: () => true,
      });
      const confirmHistorySave = jest.fn(
        async (_preview: string, signal: AbortSignal) => {
          if (mode === 'lock during consent') {
            for (const available of [false, true])
              [...listeners].forEach(listener =>
                listener({ kind: 'protectedData', available }),
              );
            expect(signal.aborted).toBe(true);
          }
          return true;
        },
      );
      const data = { openConversationArtifactStorage: async () => storage };
      const observer = { archivedAnswerMemoryTarget, confirmHistorySave };
      const action = actionSelection(observer, data);
      try {
        const tool = action.execution.actions?.find(item => item.id === toolId);
        if (!tool) throw new Error('Expected the local archived answer tool.');
        expect(JSON.stringify(tool.inputSchema)).not.toMatch(
          /Exact private|latest-visible-ordinary|new-owned-request/u,
        );
        const authorized = await tool.authorize(arm, abort.signal, operation);
        expect(authorized).toBe(mode !== 'lock during consent');
        expect(confirmHistorySave.mock.calls[0]?.[0]).toBe(answer);
        if (authorized) {
          const execution = { input: arm, signal: abort.signal, ...operation };
          if (mode === 'source reproof') {
            await f.database.execute(
              'UPDATE conversation_artifacts SET result_json = replace(result_json, ?, ?) WHERE id = ?',
              [answer, 'Changed private result.', sourceId],
            );
            await expect(tool.execute(execution)).rejects.toThrow();
          } else {
            expect((await tool.execute(execution)).items).toEqual([]);
            const receipt = await action.execution.confirmTerminalLocalAction?.(
              { ...execution, toolId, toolVersion: tool.version },
            );
            expect(receipt?.committed).toBe(true);
            expect(JSON.stringify(receipt)).not.toContain(answer);
          }
        }
        const ids = (await storage.listSavedConversationAnswers()).map(
          row => row.artifactId,
        );
        expect(ids).toEqual(mode === 'save' ? [sourceId] : []);
      } finally {
        action.disposeAnswerMemory();
        expect(listeners.size).toBe(0);
      }
    } finally {
      abort.abort();
      await f.close();
    }
  },
);
