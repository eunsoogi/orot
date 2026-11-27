import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import { createManualHistoryRepository } from '@orot/storage';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { saveConversationHealthHistory } from '../../../storage/conversationHealthHistory';
import { recoverConversationHealthHistoryResult } from '../../../storage/recoverConversationHealthHistory';
import { loadFreshConversationDialogue } from '../freshConversationDialogue';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { conversationPriorAuthoredMemoryAction } from '../conversationPriorAuthoredMemoryAction';
import { apple, localData } from '../featureServiceFixtures';
import { healthContextFixture } from '../testSupport/healthContextPersistenceFixture';

const statement = '라일락 프로젝트의 데모는 금요일인 것 같아요.';
const requestText = '그래 그럼 기억해줘';
const session = { id: 'synthetic-session', version: 0 };
const selectedModel = { providerId: APPLE_PROVIDER_ID, modelId: apple.modelId };
const runId = 'synthetic-operation';

test.each(['save', 'deleted during approval'] as const)(
  'fresh protected memory keeps the last eligible user statement after newer partial replies: %s',
  async scenario => {
    const f = await healthContextFixture();
    const signal = new AbortController().signal;
    const storage = createConversationArtifactStorage(f.database);
    const registry = new LocalEvidenceReferenceRegistry();
    try {
      await storage.createSession(
        session.id,
        await storage.currentGeneration(),
      );
      const row = (id: string, seconds: number, question: string) => ({
        id,
        question,
        sessionId: session.id,
        sessionVersion: session.version,
        createdAt: `2026-11-26T00:00:0${seconds}.000Z`,
      });
      const original = row('previous-user-statement', 0, statement);
      for (const [index, artifact] of [
        original,
        ...Array.from({ length: 4 }, (_, i) =>
          row(`partial-${i}`, i + 1, `합성 미완료 질문 ${i}.`),
        ),
      ].entries()) {
        // Legacy partial artifacts do not have a conversation request checkpoint.
        if (!index) await storage.startRequest(artifact);
        await storage.append({
          ...artifact,
          ...selectedModel,
          status: index ? 'partial' : 'complete',
          answer: '합성 답변',
          sources: [],
        });
      }
      const current = row('current-request', 7, requestText);
      await storage.startRequest(current);
      // Wanted identities still cannot admit an ineligible partial, a live
      // request, or a completed artifact belonging to another session.
      const foreign = {
        ...row('other-owner', 6, '합성 별도 기록.'),
        sessionId: 'other',
      };
      await storage.createSession(
        foreign.sessionId,
        await storage.currentGeneration(),
      );
      await storage.startRequest(foreign);
      await storage.append({
        ...foreign,
        ...selectedModel,
        status: 'complete',
        answer: '합성 답변',
        sources: [],
      });
      expect(
        await storage.readProtectedPromptHistory(
          session.id,
          session.version,
          ['partial-0', current.id, foreign.id],
          signal,
        ),
      ).toEqual([]);
      expect(
        await storage.readProtectedPromptHistory(
          session.id,
          session.version + 1,
          [],
          signal,
        ),
      ).toBeNull();
      const write = jest.fn(saveConversationHealthHistory);
      const data = {
        ...localData([]).data,
        openConversationArtifactStorage: async () => storage,
        saveConversationHistory: (
          input: Parameters<typeof write>[1],
          currentSignal: AbortSignal,
        ) => write(f.database, input, currentSignal),
        recoverConversationHistoryResult: (
          input: Parameters<typeof recoverConversationHealthHistoryResult>[1],
          currentSignal: AbortSignal,
        ) =>
          recoverConversationHealthHistoryResult(
            f.database,
            input,
            currentSignal,
          ),
      };
      const history = await loadFreshConversationDialogue(
        {
          session,
          retainedHistory: [],
          messages: [],
          registry,
          data,
          signal,
        },
        true,
      );
      expect(history?.protectedAuthoredSources).toEqual([
        {
          id: original.id,
          createdAt: original.createdAt,
          question: statement,
        },
      ]);
      const confirm = jest.fn(async () => {
        if (scenario === 'deleted during approval')
          await f.database.execute(
            'DELETE FROM conversation_artifacts WHERE id=?',
            [original.id],
          );
        return true;
      });
      const memory = conversationPriorAuthoredMemoryAction({
        question: requestText,
        history: history!,
        data,
        runId,
        observer: {
          inputOrigin: 'composer',
          expectedConversationModel: selectedModel,
          retentionSession: session,
          retentionRequestId: current.id,
          confirmHistorySave: confirm,
          templateProposalOwner: {
            ...selectedModel,
            current: () => true,
            recheck: async () => true,
            watch: () => () => {},
          },
        },
      });
      expect(memory).toBeDefined();
      const operation = {
        operationKey: 'tool-1',
        operationRunId: runId,
      };
      const input = { userMessage: statement };
      const tool = memory!.action;
      try {
        expect(tool.parseInput({ userMessage: '합성 답변' })).toBeUndefined();
        expect(tool.parseInput(input)).toEqual(input);
        expect(await tool.authorize(input, signal, operation)).toBe(true);
        expect(confirm).toHaveBeenCalledWith(statement, signal);
        const execution = {
          input,
          signal,
          ...operation,
          allowedScope: { sourceKinds: [] },
          resultLimit: 1,
          maxPayloadBytes: 512,
        };
        const records = createManualHistoryRepository(f.database);
        if (scenario === 'deleted during approval') {
          await expect(tool.execute(execution)).rejects.toThrow();
          expect(await records.list()).toEqual([]);
        } else {
          await tool.execute(execution);
          expect(
            await memory!.confirmTerminal({
              ...operation,
              signal,
              input,
              toolId: tool.id,
              toolVersion: tool.version,
            }),
          ).toMatchObject({ committed: true });
          expect((await records.list()).map(record => record.details)).toEqual([
            statement,
          ]);
        }
      } finally {
        memory?.dispose();
      }
    } finally {
      f.close();
    }
  },
);
