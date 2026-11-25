import {
  runMultiAgentWorkflow,
  type MultiAgentWorkflowOptions,
} from '@orot/agent-runtime';
import {
  providerSuccess,
  type LanguageModelProvider,
  type LanguageModelRequest,
} from '@orot/model-runtime';
import type { SqlDatabase } from '@orot/storage';
import type { GroundedRagAnswer } from '../../../ragConversation/task';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { healthContextFixture } from '../testSupport/healthContextPersistenceFixture';
import { conversationAnswerMemoryAction } from '../conversationAnswerMemoryAction';
import type { AiFeatureLocalData } from '../localData';

const sourceId = 'source-answer';
const sourceText =
  'Protected source answer never collected from a provider here.';
const arm = { target: 'previous_completed_answer' };
const runId = 'synthetic-terminal-remember-graph';
const currentId = 'follow-up-turn';
const sessionId = 'synthetic-session';
const toolId = 'remember-conversation-answer';
const empty = { items: [], coverage: [], conflicts: [] };

type Mode =
  | 'success'
  | 'already-saved'
  | 'denied'
  | 'wrong-receipt'
  | 'multi-action'
  | 'cancelled';

test.each<Mode>([
  'success',
  'already-saved',
  'denied',
  'wrong-receipt',
  'multi-action',
  'cancelled',
])('actual graph and durable app-owned answer bookmark: %s', async mode => {
  const f = await healthContextFixture();
  try {
    const signal = new AbortController();
    // Inject Stop after the actual private receipt INSERT, while the bookmark
    // and receipt are still under the same transaction and roll back together.
    const scoped: SqlDatabase = {
      ...f.database,
      transaction: work =>
        f.database.transaction(tx =>
          work({
            ...tx,
            execute: async (sql, bindings) => {
              const result = await tx.execute(sql, bindings);
              if (
                mode === 'cancelled' &&
                sql.startsWith(
                  'INSERT INTO saved_conversation_answer_terminal_receipts ',
                )
              )
                signal.abort();
              return result;
            },
          }),
        ),
    };
    const storage = createConversationArtifactStorage(scoped);
    await storage.createSession(sessionId, await storage.currentGeneration());
    const at = '2026-11-25T00:00:00.000Z';
    const previous = {
      id: sourceId,
      sessionId,
      sessionVersion: 0,
      createdAt: at,
      question: 'Synthetic preceding question',
    };
    await storage.startRequest(previous);
    await storage.append({
      ...previous,
      providerId: 'synthetic',
      modelId: 'synthetic-model',
      answer: sourceText,
      status: 'complete',
      sources: f.saved.sources,
    });
    await storage.startRequest({
      ...previous,
      id: currentId,
      createdAt: '2026-11-25T00:00:01.000Z',
      question: 'Remember the protected preceding answer.',
    });
    if (mode === 'already-saved') {
      const legacy = await storage.prepareAnswerMemory({
        id: sourceId,
        owner: { id: sessionId, version: 0 },
        currentRequestId: currentId,
        current: () => !signal.signal.aborted,
      });
      expect(await legacy?.commit()).toBe(true);
    }
    const authorize = jest.fn(async () => mode !== 'denied');
    const selected = conversationAnswerMemoryAction({
      data: {
        openConversationArtifactStorage: async () => storage,
      } as AiFeatureLocalData,
      admittedAnswerIds: new Set([sourceId]),
      terminalRunId: runId,
      observer: {
        inputOrigin: 'composer',
        retentionSession: { id: sessionId, version: 0 },
        retentionRequestId: currentId,
        retainedHistory: [{ id: sourceId, question: previous.question }],
        confirmHistorySave: authorize,
      },
    });
    const requests: LanguageModelRequest[] = [];
    const provider: LanguageModelProvider = {
      id: 'synthetic-on-device',
      kind: 'language-model',
      displayName: 'Synthetic on-device, no network.',
      capabilities: {
        streaming: false,
        toolCalling: true,
        structuredOutput: false,
        inputTypes: ['text'],
      },
      async generate(request) {
        requests.push(request);
        expect(requests).toHaveLength(1);
        expect(JSON.stringify(request)).not.toContain(sourceText);
        const chosen = { id: 'proposal', name: toolId, arguments: arm };
        return providerSuccess({
          text: 'Untrusted proposed receipt.',
          finishReason: 'tool_calls' as const,
          toolCalls:
            mode === 'multi-action'
              ? [chosen, { ...chosen, id: 'second' }]
              : [chosen],
        });
      },
    };
    const opening = jest.fn(() => 'No speculative receipt is permitted.');
    const confirm: NonNullable<
      MultiAgentWorkflowOptions<GroundedRagAnswer>['confirmTerminalLocalAction']
    > = jest.fn(async identity =>
      selected.confirmTerminal?.(
        mode === 'wrong-receipt'
          ? { ...identity, operationRunId: 'unrelated-run' }
          : identity,
      ),
    );
    const options: MultiAgentWorkflowOptions<GroundedRagAnswer> = {
      execution: {
        operationRunId: runId,
        providerId: provider.id,
        modelId: 'synthetic-model',
        recipient: 'synthetic-recipient',
        remoteProcessing: false,
        allowedScope: { sourceKinds: ['personal_record'] },
        budget: {
          maxModelCalls: 3,
          maxToolCalls: 2,
          maxResearchCycles: 1,
          maxPayloadBytes: 65536,
          maxOutputTokens: 512,
          timeoutMs: 5000,
          maxEvidenceItems: 5,
        },
      },
      provider,
      request: 'Remember the preceding answer.',
      task: {
        taskType: 'synthetic-terminal-bookmark',
        taskVersion: '1',
        systemPrompt: 'Use the indicated bookmark tool.',
        resultSchema: { type: 'object' },
        createMessages: ({ request }) => [{ role: 'user', content: request }],
        validateResult: () => ({
          status: 'invalid',
          reason: 'No model receipt.',
        }),
        initialToolResponse: opening,
        reviewInitialToolResponse: true,
      },
      initialEvidence: empty,
      tools: [],
      actions: selected.actions,
      consent: { authorize: async () => 'authorized' },
      revalidateEvidence: async () => true,
      confirmTerminalLocalAction: confirm,
    };
    const result = await runMultiAgentWorkflow(options, {
      signal: signal.signal,
    });
    expect(requests).toHaveLength(1);
    expect(opening).not.toHaveBeenCalled();
    const reopened = createConversationArtifactStorage(f.database);
    const persisted = ['success', 'already-saved', 'wrong-receipt'].includes(
      mode,
    );
    expect(await reopened.listSavedConversationAnswers()).toHaveLength(
      persisted ? 1 : 0,
    );
    expect(
      await reopened.readSavedConversationAnswer(sourceId, () => true),
    ).toEqual(persisted ? sourceText : null);
    if (mode === 'success') {
      expect(result).toMatchObject({
        status: 'result',
        value: { answer: expect.any(String), answerKind: 'conversation' },
        citations: [],
        checkpoint: { phase: 'complete', terminal: true },
      });
      if (result.status !== 'result')
        throw new Error('Missing terminal local result.');
      const resumed = await runMultiAgentWorkflow(options, {
        resumeFrom: result.checkpoint,
      });
      expect(resumed.status).not.toBe('result');
      expect(requests).toHaveLength(1);
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(selected.receipt()).toBe('saved');
      expect(await reopened.listSavedConversationAnswers()).toHaveLength(1);
    } else if (mode === 'already-saved') {
      expect(result).toMatchObject({
        status: 'result',
        value: { answer: '이미 이 기기의 기억에 저장된 답변이에요.' },
        citations: [],
        checkpoint: {
          phase: 'complete',
          terminal: true,
          committedAction: false,
        },
      });
      expect(selected.receipt()).toBe('already_saved');
    } else {
      expect(result.status).not.toBe('result');
      expect(selected.receipt()).not.toBe('saved');
      expect(confirm).toHaveBeenCalledTimes(mode === 'wrong-receipt' ? 1 : 0);
    }
  } finally {
    f.close();
  }
});
