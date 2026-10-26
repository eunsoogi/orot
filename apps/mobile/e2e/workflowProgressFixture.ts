import {
  providerSuccess,
  type LanguageModelProvider,
  type LanguageModelResponse,
  type LanguageModelStreamEvent,
} from '@orot/model-runtime';
import {
  DEFAULT_MULTI_AGENT_BUDGET,
  extractPartialJsonStringAtPath,
  type EvidenceBatch,
  type EvidenceSearchTool,
  type MultiAgentWorkflowOptions,
} from '@orot/agent-runtime';

const sourceKind = 'personal_record' as const;
const evidenceId = 'synthetic-progress-evidence';
const finalSummary = 'Synthetic answer.';
const finalText = JSON.stringify({
  type: 'result',
  value: { summary: finalSummary },
  citations: [evidenceId],
});
const partialText = '{"type":"result","value":{"summary":"A provisional';
const searchPlan = JSON.stringify({
  toolId: 'progress-search',
  sourceKind,
  input: { query: 'fixture' },
});
const initialAnswer = JSON.stringify({
  type: 'request_evidence',
  need: 'missing_coverage',
});

const evidence: EvidenceBatch = {
  items: [
    {
      sourceKind,
      sourceId: 'synthetic-local-records',
      sourceRevision: 'fixture:1',
      evidenceId,
      evidenceRevision: 'fixture:1',
      locator: { recordId: 'synthetic-record' },
      effectiveTime: '2025-01-01',
      reviewState: 'reviewed',
      content: 'Synthetic local evidence for the Hermes progress probe.',
    },
  ],
  coverage: [
    {
      sourceKind,
      searchedSourceIds: ['synthetic-local-records'],
      gaps: [],
      truncated: false,
      resultLimit: 1,
      returnedCount: 1,
    },
  ],
  conflicts: [],
};

export interface WorkflowProgressFixture {
  readonly options: MultiAgentWorkflowOptions<{ summary: string }>;
  readonly snapshotReached: Promise<void>;
  readonly releaseSnapshot: () => void;
}

/** Supplies scripted provider output and local synthetic evidence to the native graph probe. */
export function createWorkflowProgressFixture(
  runId: string,
): WorkflowProgressFixture {
  let callIndex = 0;
  let reachSnapshot!: () => void;
  let releaseSnapshot!: () => void;
  const snapshotReached = new Promise<void>(resolve => {
    reachSnapshot = resolve;
  });
  const release = new Promise<void>(resolve => {
    releaseSnapshot = resolve;
  });
  const scripted = [initialAnswer, searchPlan, finalText];
  const nextText = () => {
    const text = scripted[callIndex++];
    if (!text) throw new Error('Synthetic provider script exhausted.');
    return text;
  };
  const response = (text: string): LanguageModelResponse => ({
    text,
    toolCalls: [],
    finishReason: 'complete',
  });
  const provider: LanguageModelProvider = {
    kind: 'language-model',
    id: 'hermes-synthetic-progress',
    displayName: 'Synthetic workflow progress fixture',
    capabilities: {
      inputTypes: ['text'],
      streaming: true,
      structuredOutput: false,
      toolCalling: false,
    },
    generate: async () => providerSuccess(response(nextText())),
    async *stream() {
      const text = nextText();
      if (text === finalText) {
        yield providerSuccess<LanguageModelStreamEvent>({
          type: 'text_snapshot',
          text: partialText,
        });
        reachSnapshot();
        await release;
        yield providerSuccess<LanguageModelStreamEvent>({
          type: 'text_snapshot',
          text,
        });
      }
      yield providerSuccess<LanguageModelStreamEvent>({
        type: 'completed',
        response: response(text),
      });
    },
  };
  const tool: EvidenceSearchTool = {
    id: 'progress-search',
    sourceKind,
    execution: 'local_read_only',
    description: 'Returns synthetic workflow progress evidence.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: { query: { type: 'string' } },
      additionalProperties: false,
    },
    parseInput(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return undefined;
      const query = (value as Record<string, unknown>).query;
      return typeof query === 'string' ? { query } : undefined;
    },
    search: async () => evidence,
  };
  const task: MultiAgentWorkflowOptions<{ summary: string }>['task'] = {
    taskType: 'hermes-workflow-progress-fixture',
    taskVersion: '1',
    systemPrompt: 'Use synthetic evidence and return its summary.',
    resultSchema: {
      type: 'object',
      required: ['summary'],
      properties: { summary: { type: 'string' } },
      additionalProperties: false,
    },
    createMessages: () => [
      {
        role: 'user' as const,
        content: 'Synthetic workflow progress request.',
      },
    ],
    projectStreamedText: raw =>
      extractPartialJsonStringAtPath(raw, ['value', 'summary']),
    validateResult(value: unknown) {
      const summary =
        typeof value === 'object' && value !== null && !Array.isArray(value)
          ? (value as Record<string, unknown>).summary
          : undefined;
      if (typeof summary === 'string')
        return { status: 'valid' as const, value: { summary } };
      return {
        status: 'invalid' as const,
        reason: 'A synthetic summary is required.',
      };
    },
  };
  const options: MultiAgentWorkflowOptions<{ summary: string }> = {
    execution: {
      operationRunId: runId,
      providerId: provider.id,
      modelId: 'synthetic-model',
      recipient: 'hermes-fixture',
      remoteProcessing: false,
      allowedScope: { sourceKinds: [sourceKind] },
      budget: DEFAULT_MULTI_AGENT_BUDGET,
    },
    provider,
    request: 'Private synthetic workflow progress request.',
    task,
    initialEvidence: { items: [], coverage: [], conflicts: [] },
    tools: [tool],
    consent: { authorize: async () => 'authorized' },
    revalidateEvidence: async () => true,
  };
  return { options, snapshotReached, releaseSnapshot };
}
