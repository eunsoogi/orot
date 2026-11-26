import { runMultiAgentWorkflow } from '@orot/agent-runtime';
import { createManualHistoryRepository, type SqlDatabase } from '@orot/storage';
import type { GroundedRagAnswer } from '../../../ragConversation/task';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { confirmAuthoredMemoryTerminal } from '../../../storage/conversationAuthoredMemoryTerminal';
import { saveConversationHealthHistory } from '../../../storage/conversationHealthHistory';
import { healthContextFixture } from '../testSupport/healthContextPersistenceFixture';
import { conversationMutationExecution } from '../conversationMutationExecution';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { executionOptions } from '../featureServiceExecution';
import {
  authoredPlanModel,
  syntheticAuthoredPlan,
} from '../testSupport/syntheticAuthoredPlan';
import type { AiFeatureLocalData } from '../localData';

const runId = 'synthetic-authored-terminal-run';
const sessionId = 'synthetic-authored-session';
const requestId = 'synthetic-authored-request';
const modelId = authoredPlanModel;
const toolId = 'remember-current-user-statement';
const statement = 'The lilac project demo takes place each Friday.';
const request = `${statement} Please remember this.`;
const empty = { items: [], coverage: [], conflicts: [] };
const tests = [
  'success',
  'denied',
  'owner-retired',
  'locked-in-transaction',
  'wrong-text',
  'wrong-proof',
] as const;

test.each(tests)(
  'ordinary ChatGPT Plan uses a local-only terminal receipt: %s',
  async mode => {
    const f = await healthContextFixture();
    try {
      const storage = createConversationArtifactStorage(f.database);
      await storage.createSession(sessionId, await storage.currentGeneration());
      await storage.startRequest({
        id: requestId,
        sessionId,
        sessionVersion: 0,
        createdAt: '2026-11-25T00:00:00.000Z',
        question: request,
      });
      let watching: (() => void) | undefined;
      let ownerCurrent = true;
      const retire = () => {
        ownerCurrent = false;
        watching?.();
        // Returning to the same model does not revive the earlier local approval.
        ownerCurrent = true;
      };
      const database: SqlDatabase = {
        ...f.database,
        transaction: work =>
          f.database.transaction(tx =>
            work({
              ...tx,
              execute: async (sql, bindings) => {
                const result = await tx.execute(sql, bindings);
                if (
                  mode === 'locked-in-transaction' &&
                  sql.startsWith('INSERT INTO conversation_history_receipts')
                )
                  retire();
                return result;
              },
            }),
          ),
      };
      const approve = jest.fn(async () => {
        if (mode === 'owner-retired') retire();
        return mode !== 'denied';
      });
      const persist = jest.fn(
        (
          input: Parameters<typeof saveConversationHealthHistory>[1],
          signal: AbortSignal,
        ) => saveConversationHealthHistory(database, input, signal),
      );
      const confirm = jest.fn(
        (
          input: Parameters<typeof confirmAuthoredMemoryTerminal>[1],
          signal: AbortSignal,
        ) => confirmAuthoredMemoryTerminal(f.database, input, signal),
      );
      const { provider, requests } = syntheticAuthoredPlan(
        toolId,
        mode === 'wrong-text' ? 'A different invented sentence.' : statement,
      );
      const providerId = provider.id;
      type Mutation = Parameters<typeof conversationMutationExecution>[0];
      const selected = {
        status: 'ready',
        selection: { providerId, modelId },
        provider,
        modelId,
        remoteProcessing: true,
        recipient: 'synthetic-local-fixture',
      } as Mutation['selected'];
      const registry = new LocalEvidenceReferenceRegistry();
      const consent = { authorize: async () => 'authorized' as const };
      const baseExecution = executionOptions({
        selected,
        operationRunId: runId,
        registry,
        consent,
        consentPurpose: 'record_conversation',
        tools: [],
      });
      const mutation = conversationMutationExecution({
        baseExecution,
        photo: undefined,
        photoEvidence: undefined,
        selected,
        data: {
          saveConversationHistory: persist,
          confirmAuthoredMemoryTerminal: confirm,
        } as unknown as AiFeatureLocalData,
        registry,
        observer: {
          inputOrigin: 'composer',
          retentionSession: { id: sessionId, version: 0 },
          retentionRequestId: requestId,
          confirmHistorySave: approve,
          templateProposalOwner: {
            providerId:
              mode === 'wrong-proof' ? 'chatgpt-plan:other' : providerId,
            modelId,
            current: () => ownerCurrent,
            recheck: async () => ownerCurrent,
            watch: dispose => {
              watching = dispose;
              return () => {
                watching = undefined;
              };
            },
          },
        },
        question: request,
        history: {
          messages: [],
          reports: [],
          references: [],
          sources: [],
          priorTurns: [],
          omitted: false,
          excludedQuestions: [],
        },
        remoteAnswerMemory: true,
      });
      const actions =
        'actions' in mutation.execution ? mutation.execution.actions : [];
      if (mode === 'wrong-proof') {
        expect(actions.some(action => action.id === toolId)).toBe(false);
        expect(requests).toEqual([]);
        expect(persist).not.toHaveBeenCalled();
        return;
      }
      expect(actions.find(action => action.id === toolId)?.completion).toBe(
        'host_terminal',
      );
      const opening = jest.fn(() => 'No speculative receipt');
      const result = await runMultiAgentWorkflow<GroundedRagAnswer>({
        ...baseExecution,
        request,
        task: {
          taskType: 'synthetic-authored-terminal',
          taskVersion: '1',
          systemPrompt: 'Propose the authored memory tool.',
          resultSchema: { type: 'object' },
          createMessages: ({ request: user }) => [
            { role: 'user', content: user },
          ],
          validateResult: () => ({
            status: 'invalid',
            reason: 'No model receipt.',
          }),
          initialToolResponse: opening,
          reviewInitialToolResponse: true,
        },
        initialEvidence: empty,
        actions,
        confirmTerminalLocalAction:
          'confirmTerminalLocalAction' in mutation.execution
            ? mutation.execution.confirmTerminalLocalAction
            : undefined,
      });
      expect(requests).toHaveLength(1);
      expect(opening).not.toHaveBeenCalled();
      expect(
        requests[0]?.messages.some(
          message =>
            'type' in message && message.type === 'function_call_output',
        ),
      ).toBe(false);
      for (const marker of [requestId, sessionId, 'local-conversation-memory:'])
        expect(JSON.stringify(requests[0])).not.toContain(marker);
      const notes = createManualHistoryRepository(f.database);
      if (mode === 'success') {
        expect(result).toMatchObject({
          status: 'result',
          citations: [],
          checkpoint: { terminal: true, committedAction: true },
        });
        expect(mutation.memorySaved()).toBe('saved');
        expect(approve).toHaveBeenCalledWith(statement, expect.anything());
        expect(persist).toHaveBeenCalledTimes(1);
        expect(confirm).toHaveBeenCalledTimes(1);
        expect((await notes.list()).map(note => note.details)).toEqual([
          statement,
        ]);
        expect(await notes.listEvidence()).toEqual([]);
      } else {
        expect(result.status).not.toBe('result');
        expect(await notes.list()).toEqual([]);
        expect(confirm).not.toHaveBeenCalled();
        expect(persist).toHaveBeenCalledTimes(
          mode === 'locked-in-transaction' ? 1 : 0,
        );
      }
      mutation.disposeAnswerMemory();
    } finally {
      f.close();
    }
  },
);
