import { providerSuccess } from '@orot/model-runtime';
import type {
  LanguageModelProvider,
  LanguageModelRequest,
} from '@orot/model-runtime';
import type { EvidenceReference } from '@orot/agent-runtime';

/** Synthetic model output only: citations are read from the real graph's current evidence. */
export function createStoreWorkflowProvider(
  query: string,
  forbiddenId: string,
) {
  let calls = 0;
  const provider: LanguageModelProvider = {
    kind: 'language-model',
    id: 'store-persistence-synthetic-model',
    displayName: 'Synthetic Store persistence model',
    capabilities: {
      inputTypes: ['text'],
      streaming: false,
      structuredOutput: false,
      toolCalling: true,
    },
    async generate(request) {
      if (JSON.stringify(request).includes(forbiddenId))
        throw new Error(
          'A private Store fixture identifier reached the provider.',
        );
      calls += 1;
      if (calls === 1)
        return providerSuccess({
          text: '',
          finishReason: 'tool_calls',
          toolCalls: [
            {
              id: 'reviewed-memory-search',
              name: 'visit-question-reviewed-memory-search',
              arguments: { query },
            },
          ],
        });
      if (calls !== 2)
        throw new Error('Unexpected synthetic provider dispatch.');
      const citation = references(request)[0];
      if (!citation)
        return providerSuccess({
          text: JSON.stringify({
            type: 'result',
            value: {
              status: 'needs_clarification',
              message: '진료에서 확인할 기록을 먼저 선택해 주세요.',
            },
            citations: [],
          }),
          toolCalls: [],
          finishReason: 'complete',
        });
      return providerSuccess({
        text: JSON.stringify({
          type: 'result',
          value: {
            status: 'suggestions',
            questions: [
              '다음 외래 알림 시간은 어떻게 정하면 좋을까요?',
              '진료 전에 확인할 내용을 언제 기록하면 좋을까요?',
              '다음 진료 전 준비할 사항을 함께 확인해도 될까요?',
            ].map(questionText => ({
              questionText,
              rationale:
                '사용자가 확인한 외래 알림 선호를 바탕으로 진료 준비를 물어요.',
              priority: 'routine',
              evidenceIds: [citation.evidenceId],
            })),
          },
          citations: [citation],
        }),
        toolCalls: [],
        finishReason: 'complete',
      });
    },
  };
  return { provider, calls: () => calls };
}

function references(request: LanguageModelRequest): EvidenceReference[] {
  const marker =
    'Allowed citation references (return citations as their evidenceId strings; do not invent IDs):\n';
  for (const message of [...request.messages].reverse()) {
    if (
      message.role !== 'tool' &&
      typeof message.content === 'string' &&
      message.content.startsWith(marker)
    )
      return JSON.parse(
        message.content.slice(marker.length),
      ) as EvidenceReference[];
  }
  throw new Error('The real graph omitted its citation reference message.');
}
