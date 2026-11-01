import { DEFAULT_MULTI_AGENT_BUDGET } from '@orot/agent-runtime';
import { providerSuccess } from '@orot/model-runtime';
import type { RagConversationRunOptions } from '../service';

const reference = {
  sourceKind: 'external_medical' as const,
  sourceId: 'synthetic-source',
  sourceRevision: '1',
  evidenceId: 'synthetic-evidence',
  evidenceRevision: '1',
  locator: { kind: 'structured_record', recordId: 'synthetic' },
  effectiveTime: null,
  reviewState: 'reviewed' as const,
};
const chunk = {
  id: 'synthetic',
  text: 'Synthetic evidence',
  metadata: { sourceId: reference.sourceId, evidenceId: reference.evidenceId },
};
export const malformed = () =>
  response({
    type: 'result',
    value: { answerKind: 'grounded', answer: '기록에 증상이 있어요.' },
    citations: 'synthetic-evidence',
  });
export const valid = (
  citations: unknown = ['synthetic-evidence'],
  answer: unknown = '기록에 증상이 있어요.',
) =>
  response({
    type: 'result',
    value: { answerKind: 'grounded', answer },
    citations,
  });
export function response(value: unknown) {
  return providerSuccess({
    text: JSON.stringify(value),
    toolCalls: [],
    finishReason: 'complete',
  });
}

/** Drive the real conversation adapter and runtime with synthetic, already selected evidence. */
export function fixture() {
  const generate = jest
    .fn()
    .mockResolvedValueOnce(malformed())
    .mockResolvedValueOnce(valid());
  const authorize = jest.fn(async () => 'authorized' as const);
  const revalidateEvidence = jest.fn(async () => true);
  const options: RagConversationRunOptions = {
    question: '기록을 알려 주세요',
    previousMessages: [],
    loadCurrentEvidence: async () => ({
      batch: {
        items: [{ ...reference, content: 'Synthetic evidence' }],
        coverage: [
          {
            sourceKind: 'external_medical',
            searchedSourceIds: [reference.sourceId],
            gaps: [],
            truncated: false,
            resultLimit: 1,
            returnedCount: 1,
          },
        ],
        conflicts: [],
      },
      chunks: [chunk as never],
    }),
    rag: { search: jest.fn(async () => [{ chunk, score: 1 }] as never) },
    workflow: {
      execution: {
        operationRunId: 'synthetic',
        providerId: 'sample',
        modelId: 'sample',
        recipient: 'device',
        remoteProcessing: false,
        allowedScope: { sourceKinds: ['external_medical'] },
        budget: { ...DEFAULT_MULTI_AGENT_BUDGET, timeoutMs: null },
      },
      provider: {
        kind: 'language-model',
        id: 'sample',
        displayName: 'Sample',
        capabilities: {
          inputTypes: ['text'],
          streaming: false,
          structuredOutput: false,
          toolCalling: false,
        },
        generate,
      },
      tools: [],
      consent: { authorize },
      revalidateEvidence,
    } as never,
  };
  return { options, generate, authorize, revalidateEvidence };
}
