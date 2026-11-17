import {
  DEFAULT_MULTI_AGENT_BUDGET,
  runMultiAgentWorkflow,
} from '@orot/agent-runtime';
import type { EvidenceBatch, EvidenceSearchTool } from '@orot/agent-runtime';
import { providerSuccess } from '@orot/model-runtime';
import type {
  LanguageModelRequest,
  LanguageModelProvider,
} from '@orot/model-runtime';
import { jsonByteLength } from '../../aiFeatures/integration/evidenceUtils';
import { ragConversationTask } from '../task';
import { conversationWorkflowContext } from '../conversationWorkflowContext';
import { fixture as conversationFixture } from '../testSupport/conversationEnvelopeFixtures';

// Synthetic content only. Exercise actual request construction and authorization,
// not a replacement size estimator or a live account/model.
function fixture(size = 36_000) {
  const content = 'SYNTHETIC_PAYLOAD_' + 'x'.repeat(size);
  const batch: EvidenceBatch = {
    items: [
      {
        sourceKind: 'personal_record',
        sourceId: 'fixture-source',
        sourceRevision: '1',
        evidenceId: 'fixture-evidence',
        evidenceRevision: '1',
        locator: { kind: 'structured_record', recordId: 'fixture' },
        effectiveTime: null,
        reviewState: 'unknown',
        content,
      },
    ],
    coverage: [
      {
        sourceKind: 'personal_record',
        searchedSourceIds: ['fixture-source'],
        gaps: [],
        truncated: false,
        resultLimit: 1,
        returnedCount: 1,
      },
    ],
    conflicts: [],
  };
  const search = jest.fn(async () => batch);
  const tool: EvidenceSearchTool = {
    id: 'synthetic-local-search',
    sourceKind: 'personal_record',
    execution: 'local_read_only',
    description: 'Read synthetic evidence.',
    inputSchema: { type: 'object', properties: {} },
    parseInput: () => ({}),
    search,
  };
  const requests: LanguageModelRequest[] = [];
  const provider: LanguageModelProvider = {
    kind: 'language-model',
    id: 'fixture',
    displayName: 'Fixture',
    capabilities: {
      inputTypes: ['text'],
      streaming: false,
      structuredOutput: true,
      toolCalling: true,
    },
    generate: jest.fn(async request => {
      requests.push(request);
      return requests.length === 1
        ? providerSuccess({
            text: '',
            toolCalls: [{ id: 'fixture-call', name: tool.id, arguments: {} }],
            finishReason: 'tool_calls' as const,
          })
        : providerSuccess({
            text: JSON.stringify({
              type: 'result',
              value: { answerKind: 'grounded', answer: '기록을 확인했어요.' },
              citations: ['fixture-evidence'],
            }),
            toolCalls: [],
            finishReason: 'complete' as const,
          });
    }),
  };
  const authorize = jest.fn(async () => 'authorized' as const);
  const revalidateEvidence = jest.fn(async () => true);
  const options = {
    execution: {
      operationRunId: 'fixture-run',
      providerId: provider.id,
      modelId: 'fixture',
      recipient: 'fixture',
      remoteProcessing: true,
      allowedScope: { sourceKinds: ['personal_record' as const] },
      budget: { ...DEFAULT_MULTI_AGENT_BUDGET, timeoutMs: null },
    },
    provider,
    task: ragConversationTask,
    request: '기록을 알려 주세요',
    initialEvidence: { items: [], coverage: [], conflicts: [] },
    tools: [tool],
    consent: { authorize },
    revalidateEvidence,
  };
  return {
    options,
    requests,
    content,
    batch,
    search,
    authorize,
    revalidateEvidence,
  };
}

test('sends a bounded retrieved body once while preserving the matching tool receipt and citation', async () => {
  const f = fixture();
  expect(jsonByteLength(f.batch)).toBeLessThan(65536);
  const result = await runMultiAgentWorkflow(f.options);
  expect(result.status).toBe('result');
  expect(f.requests).toHaveLength(2);
  const request = f.requests[1]!;
  const serialized = JSON.stringify(request);
  expect(serialized.split(f.content)).toHaveLength(2);
  expect(jsonByteLength(request)).toBeLessThanOrEqual(65536);
  expect(request.messages).toContainEqual(
    expect.objectContaining({
      role: 'tool',
      toolCallId: 'fixture-call',
      result: {
        contentLocation: 'current_task_messages',
        evidenceIds: ['fixture-evidence'],
        coverage: f.batch.coverage,
        conflicts: [],
      },
    }),
  );
  expect(result).toMatchObject({
    citations: [
      expect.objectContaining({
        evidenceId: 'fixture-evidence',
        sourceRevision: '1',
        evidenceRevision: '1',
      }),
    ],
  });
  expect(f.authorize).toHaveBeenCalledTimes(2);
  expect(f.revalidateEvidence).toHaveBeenCalled();
});

test('does not waive the final request limit when the single evidence body is too large', async () => {
  const f = fixture(61_000);
  expect(jsonByteLength(f.batch)).toBeLessThan(65536);
  expect(await runMultiAgentWorkflow(f.options)).toMatchObject({
    status: 'budget_exceeded',
  });
  expect(f.requests).toHaveLength(1);
});

test('cannot send the final evidence after payload consent is denied', async () => {
  const f = fixture();
  f.authorize
    .mockResolvedValueOnce('authorized')
    .mockResolvedValueOnce('denied' as never);
  expect(await runMultiAgentWorkflow(f.options)).toMatchObject({
    status: 'consent_required',
  });
  expect(f.requests).toHaveLength(1);
});

test('cannot send evidence that fails current source validation', async () => {
  const f = fixture();
  f.revalidateEvidence.mockResolvedValue(false);
  expect(await runMultiAgentWorkflow(f.options)).not.toMatchObject({
    status: 'result',
  });
  expect(f.requests).toHaveLength(1);
});

test('interactive requests can cross the old aggregate cap without raising evidence or loop limits', async () => {
  const f = fixture(61_000);
  const result = await runMultiAgentWorkflow({
    ...f.options,
    execution: {
      ...f.options.execution,
      budget: { ...f.options.execution.budget, maxModelRequestBytes: null },
    },
  });
  expect(result.status).toBe('result');
  expect(f.requests).toHaveLength(2);
  expect(jsonByteLength(f.requests[1])).toBeGreaterThan(65536);
  expect(f.authorize).toHaveBeenCalledTimes(2);
});

test('keeps a historical question once through tool rounds without bypassing authorization', async () => {
  const f = fixture(61_000);
  const question = 'SYNTHETIC_PRIOR_QUESTION_' + 'q'.repeat(900);
  const result = await runMultiAgentWorkflow({
    ...f.options,
    context: conversationWorkflowContext({
      ...conversationFixture().options,
      previousMessages: [{ role: 'user', content: question }],
      validatedPriorTurns: [{ question, answer: 'synthetic validated answer' }],
    }),
    execution: {
      ...f.options.execution,
      budget: { ...f.options.execution.budget, maxModelRequestBytes: null },
    },
  });
  expect(result.status).toBe('result');
  expect(f.requests).toHaveLength(2);
  for (const request of f.requests) {
    expect(JSON.stringify(request).split(question)).toHaveLength(2);
  }
  expect(JSON.stringify(f.requests[1]).split(f.content)).toHaveLength(2);
  expect(result).toMatchObject({
    citations: [expect.objectContaining({ evidenceId: 'fixture-evidence' })],
  });
  expect(f.authorize).toHaveBeenCalledTimes(2);
  expect(f.revalidateEvidence).toHaveBeenCalled();
});
