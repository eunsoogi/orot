import { createAgentMemory, listSavedMemories } from '@orot/agent-memory';
import { SqlCipherAgentMemoryStorage } from '../../storage/agentMemoryStorage';
import { processStatementMemoryJobs } from '../../memory/userStatementMemoryProcessing';
import {
  DEFAULT_MULTI_AGENT_BUDGET,
  runMultiAgentWorkflow,
} from '@orot/agent-runtime';
import {
  providerSuccess,
  type JsonValue,
  type LanguageModelProvider,
  type LanguageModelRequest,
} from '@orot/model-runtime';
import { runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../healthEvidence/localEvidenceTestSupport';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { ensureStatementMemoryJobs } from '../../storage/userStatementMemoryJobs';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { createConversationRetentionBridge } from '../../aiFeatures/integration/conversationRetentionBridge';
import { conversationWorkflowOutcome } from '../conversationWorkflowOutcome';
import { restoreConversationTask } from '../conversationTaskVersions';
import { ragConversationTask } from '../task';
const request = '앞으로는 한 번에 한 질문씩 듣고 싶어요.';
const answer = {
  answerKind: 'conversation',
  answer: '그렇게 맞춰서 설명할게요.',
};
const initialEvidence = { items: [], conflicts: [], coverage: [] };

async function run(selection: JsonValue | undefined, question: string) {
  const generate = jest.fn(async (_request: LanguageModelRequest) =>
    providerSuccess({
      text: JSON.stringify({
        type: 'result',
        value: { ...answer, rememberCurrentStatement: selection },
        citations: [],
      }),
      toolCalls: [],
      finishReason: 'complete' as const,
    }),
  );
  const provider: LanguageModelProvider = {
    kind: 'language-model',
    id: 'synthetic',
    displayName: 'synthetic',
    capabilities: {
      inputTypes: ['text'],
      structuredOutput: false,
      streaming: false,
      toolCalling: false,
    },
    generate,
  };
  const workflow = {
    provider,
    task: ragConversationTask,
    request: question,
    initialEvidence,
    tools: [],
    execution: {
      operationRunId: 'synthetic',
      providerId: 'synthetic',
      modelId: 'synthetic',
      recipient: 'synthetic-local',
      remoteProcessing: false,
      allowedScope: { sourceKinds: ['reviewed_memory' as const] },
      budget: DEFAULT_MULTI_AGENT_BUDGET,
    },
    consent: { authorize: async () => 'authorized' as const },
    revalidateEvidence: async () => true,
  };
  const result = await runMultiAgentWorkflow(workflow);
  expect(generate).toHaveBeenCalledTimes(1);
  return { result, workflow, providerRequest: generate.mock.calls[0]?.[0] };
}

test.each([
  [true, false, request, true],
  [false, false, request, true],
  [undefined, false, request, true],
  ['model-authored contents', false, request, true],
  [true, true, request, true],
  [true, false, 'For future replies, I prefer concise answers.', true],
  [true, false, 'I practice the guitar every Monday.', true],
  [
    true,
    false,
    'For future replies, I prefer that you never retain this conversation.',
    false,
  ],
  [true, false, '앞으로 질문에 이 말은 보관하지 않고 답하기를 원해요.', false],
  [
    true,
    false,
    'For future replies, I prefer not to receive long answers.',
    false,
  ],
  [
    true,
    false,
    'For future replies, I prefer you include my banking PIN code.',
    false,
  ],
  [true, false, '저는 오랫동안 다른 사람을 돌보고 있어요.', false, true],
  [true, false, 'I prefer that you never retain my words.', false],
] as const)(
  'old model proposals cannot enqueue or drain into embedded memory (%s, delete %s, %s)',
  async (
    selection,
    deleteBeforeDrain,
    question,
    eligible,
    legacy: boolean = false,
  ) => {
    const { result, workflow, providerRequest } = await run(
      selection,
      question,
    );
    const f = createHealthEvidenceTestDatabase();
    const signal = new AbortController().signal;
    try {
      await runMigrations(f.database);
      const storage = createConversationArtifactStorage(f.database);
      await storage.createSession('session', await storage.currentGeneration());
      await ensureStatementMemoryJobs(f.database);
      const jobs = async () =>
        (
          await f.database.execute(
            'SELECT source_id FROM user_statement_memory_jobs',
          )
        ).rows;
      let beforeCommit: unknown;
      let proposed: unknown;
      const retention = createConversationRetentionBridge({
        registry: new LocalEvidenceReferenceRegistry(),
        question,
        providerId: 'synthetic',
        modelId: 'synthetic',
        signal,
        observer: {
          async onRetentionCandidate(candidate) {
            beforeCommit = await jobs();
            proposed = candidate.proactiveMemory;
            await storage.append({
              ...candidate,
              id: 'synthetic-user-turn',
              sessionId: 'session',
              createdAt: '2026-11-22T00:00:00.000Z',
              status: 'complete',
            });
          },
        },
      });
      const outcome = await conversationWorkflowOutcome(
        result,
        { workflow, onValidatedEvidence: retention.onValidatedEvidence },
        signal,
      );
      expect(outcome.status).toBe('answer');
      expect(await jobs()).toEqual([]);
      expect((await retention.finish(outcome)).retained).toBe(true);
      expect(beforeCommit).toEqual([]);
      const queued = await jobs();
      const admitted = legacy;
      if (eligible && selection === true) {
        // Simulate a queued job restored from a build that persisted model advice.
        await f.database.execute(
          "INSERT INTO user_statement_memory_jobs (source_kind, source_id) VALUES ('conversation_user_statement', ?)",
          ['synthetic-user-turn'],
        );
      }
      const memoryStorage = new SqlCipherAgentMemoryStorage(f.database);
      const memory = await createAgentMemory({
        storage: memoryStorage,
        embedder: {
          embed: async texts => texts.map(() => new Float32Array([1, 0])),
        },
      });
      try {
        if (deleteBeforeDrain) await storage.deleteSession('session');
        await processStatementMemoryJobs(f.database, memory);
        const rows = await listSavedMemories(
          new SqlCipherAgentMemoryStorage(f.database),
        );
        const shouldRemember = admitted && !deleteBeforeDrain;
        expect(rows).toHaveLength(shouldRemember ? 1 : 0);
        if (shouldRemember) {
          expect(rows[0].provenance.reviewState).toBe('user_stated');
          expect(
            (await memory.recall('합성 질문 선호', { limit: 1 }))[0]?.text,
          ).toContain(question);
        }
        if (!deleteBeforeDrain) await storage.deleteSession('session');
        expect(await listSavedMemories(memoryStorage)).toEqual([]);
      } finally {
        await memory.close();
      }
      expect(await jobs()).toEqual([]);
      expect(queued).toEqual(
        admitted ? [{ source_id: 'synthetic-user-turn' }] : [],
      );
      expect(proposed).toBe(eligible && selection === true ? true : undefined);
      expect(
        JSON.stringify(providerRequest).includes('rememberCurrentStatement'),
      ).toBe(eligible);
    } finally {
      f.close();
    }
  },
);

test.each([
  [request, { intent: 'health-summary' }],
  [request, { intent: 'daily-report' }],
  [request, { intent: 'visit-questions' }],
  [request, { intent: 'possibilities' }],
  [request, { photoAttachment: true }],
  ['앞으로 답변은 짧게 해주시겠어요?', undefined],
  ['앞으로 한 번에 한 질문씩 듣고 싶지만 저장하지 말아 주세요.', undefined],
  ['오늘 잠깐 머리가 아파요.', undefined],
] as const)(
  'does not grant unrelated request or route authority: %s',
  (input, context) => {
    const args = { request: input, context, evidence: initialEvidence };
    expect(
      ragConversationTask.createResultSchema!(args).properties,
    ).not.toHaveProperty('rememberCurrentStatement');
    const result = ragConversationTask.validateResult(
      { ...answer, rememberCurrentStatement: true },
      args,
    );
    if (result.status === 'valid')
      expect(result.value.proactiveMemory).toBeUndefined();
  },
);

test('keeps previously checkpointed v15 task input unchanged', () => {
  const input = { request, evidence: initialEvidence };
  expect(
    ragConversationTask.createResultSchema!(input).properties,
  ).toHaveProperty('rememberCurrentStatement');
  const restored = restoreConversationTask({
    taskType: ragConversationTask.taskType,
    taskVersion: '15',
  });
  expect(restored?.createResultSchema?.(input).properties).not.toHaveProperty(
    'rememberCurrentStatement',
  );
});
