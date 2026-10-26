import {
  createEuropePmcEvidenceSearchTool,
  runMultiAgentWorkflow,
} from '@orot/agent-runtime';
import type {
  EvidenceBatch,
  EvidenceSearchTool,
  TaskResponderContract,
} from '@orot/agent-runtime';
import { providerSuccess } from '@orot/model-runtime';
import type {
  JsonObject,
  LanguageModelProvider,
  LanguageModelRequest,
} from '@orot/model-runtime';
import { runStandardAdaptersAppleProbe } from './standardAdaptersAppleProbe';
import { runStandardAdaptersOpenAIProbe } from './standardAdaptersOpenAIProbe';
import { runPrivacySafeCallbacksProbe } from './privacySafeCallbacksProbe';

/** Each mock-backed probe owns a separate port and receipt; no live account or model inference is used. */
export async function runStandardAdaptersProbe() {
  const apple = await runStandardAdaptersAppleProbe();
  const openai = await runStandardAdaptersOpenAIProbe();
  const graph = await runHermesToolMessageGraphProbe();
  const privacySafeCallbacks = await runPrivacySafeCallbacksProbe();
  return {
    apple,
    openai,
    graph,
    privacySafeCallbacks,
    synthetic: true,
    modelExecution: 'mock',
    actualModel: 'not-run',
    realAccount: 'unverified',
  };
}

/** Exercise a synthetic evidence-tool round trip through the multi-agent graph in the Hermes test host. */
async function runHermesToolMessageGraphProbe() {
  const callId = 'call_hermes_graph';
  const publication = {
    provider: 'Europe PMC' as const,
    recordId: 'source-42',
    source: 'MED',
    title: 'Synthetic graph result',
    authors: 'Fixture Author',
    journal: 'Fixture Journal',
    publicationDate: '2025-02-10',
    updatedDate: '2025-03-15',
    abstract: 'Synthetic evidence returned through the graph tool.',
    originalUrl: 'https://europepmc.org/article/MED/source-42',
    retrievedAt: '2026-10-27T00:00:00.000Z',
  };
  const evidenceAdapter = createEuropePmcEvidenceSearchTool({
    service: {
      search: async () => ({
        status: 'available',
        publications: [publication],
      }),
    },
    consent: { authorize: async () => 'authorized' },
  });
  const inputSchema = {
    type: 'object',
    properties: { sourceId: { type: 'string' } },
    required: ['sourceId'],
    additionalProperties: false,
  } as JsonObject;
  let searchCalls = 0;
  let evidence: EvidenceBatch | undefined;
  const tool: EvidenceSearchTool = {
    ...evidenceAdapter,
    id: 'lookup_source',
    description: 'Look up one synthetic source.',
    inputSchema,
    parseInput(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return undefined;
      const candidate = value as Record<string, unknown>;
      return Object.keys(candidate).length === 1 &&
        typeof candidate.sourceId === 'string' &&
        candidate.sourceId.trim()
        ? { sourceId: candidate.sourceId.trim() }
        : undefined;
    },
    async search(request) {
      searchCalls += 1;
      const sourceId = request.input.sourceId;
      if (typeof sourceId !== 'string')
        throw new Error('The synthetic source ID was invalid.');
      const result = await evidenceAdapter.search({
        ...request,
        input: { query: sourceId },
      });
      if (!('status' in result)) evidence = result;
      return result;
    },
  };

  const requests: LanguageModelRequest[] = [];
  let messageRoundTrip = false;
  let returnedToolCallId = '';
  const provider: LanguageModelProvider = {
    kind: 'language-model',
    id: 'hermes-standard-tool-graph',
    displayName: 'Synthetic Hermes graph provider',
    capabilities: {
      inputTypes: ['text'],
      streaming: false,
      structuredOutput: false,
      toolCalling: true,
    },
    async generate(request) {
      requests.push(request);
      if (requests.length === 1) {
        if (
          request.toolChoice !== 'required' ||
          request.tools?.[0]?.name !== tool.id
        )
          throw new Error('The first graph turn did not bind the native tool.');
        return providerSuccess({
          text: '',
          toolCalls: [
            { id: callId, name: tool.id, arguments: { sourceId: 'source-42' } },
          ],
          finishReason: 'tool_calls',
        });
      }
      const assistant = request.messages.find(
        message =>
          message.role === 'assistant' &&
          message.toolCalls?.some(call => call.id === callId),
      );
      const toolResult = request.messages.find(
        message => message.role === 'tool' && message.toolCallId === callId,
      );
      returnedToolCallId =
        toolResult?.role === 'tool' ? toolResult.toolCallId : '';
      const result =
        toolResult?.role === 'tool' ? toolResult.result : undefined;
      const resultItems =
        result && typeof result === 'object' && !Array.isArray(result)
          ? (result as Record<string, unknown>).items
          : undefined;
      messageRoundTrip = Boolean(
        assistant?.role === 'assistant' &&
        assistant.toolCalls?.length === 1 &&
        toolResult?.role === 'tool' &&
        Array.isArray(resultItems) &&
        resultItems.length === 1 &&
        request.tools === undefined,
      );
      const citation = evidence?.items[0]?.evidenceId;
      return providerSuccess({
        text: JSON.stringify({
          type: 'result',
          value: { summary: 'Source found.' },
          citations: citation ? [citation] : [],
        }),
        toolCalls: [],
        finishReason: 'complete',
      });
    },
  };
  const task: TaskResponderContract<{ summary: string }> = {
    taskType: 'synthetic-tool-round-trip',
    taskVersion: '1',
    systemPrompt: 'Return a short summary of the supplied synthetic source.',
    resultSchema: {
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
      additionalProperties: false,
    },
    createMessages: () => [{ role: 'user', content: 'Look up source-42.' }],
    validateResult(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return { status: 'invalid', reason: 'A summary is required.' };
      const summary = (value as Record<string, unknown>).summary;
      return typeof summary === 'string'
        ? { status: 'valid', value: { summary } }
        : { status: 'invalid', reason: 'A summary is required.' };
    },
  };
  const result = await runMultiAgentWorkflow({
    execution: {
      operationRunId: 'hermes-standard-tool-graph',
      providerId: provider.id,
      modelId: 'synthetic',
      recipient: 'local-fixture',
      remoteProcessing: true,
      allowedScope: { sourceKinds: ['external_medical'] },
      budget: {
        maxModelCalls: 2,
        maxToolCalls: 1,
        maxResearchCycles: 1,
        maxPayloadBytes: 64 * 1024,
        maxOutputTokens: 512,
        timeoutMs: 5000,
        maxEvidenceItems: 2,
      },
    },
    provider,
    request: 'Look up one synthetic source.',
    task,
    initialEvidence: { items: [], coverage: [], conflicts: [] },
    tools: [tool],
    consent: { authorize: async () => 'authorized' },
    revalidateEvidence: async () => true,
  });
  if (
    result.status !== 'result' ||
    !messageRoundTrip ||
    returnedToolCallId !== callId ||
    requests.length !== 2 ||
    searchCalls !== 1
  )
    throw new Error(
      'The Hermes graph did not round-trip one matching tool message.',
    );
  return {
    status: result.status,
    toolCallId: callId,
    toolMessageCallId: returnedToolCallId,
    searchCalls,
    modelCalls: requests.length,
    messageRoundTrip,
    summary: result.value.summary,
  };
}
