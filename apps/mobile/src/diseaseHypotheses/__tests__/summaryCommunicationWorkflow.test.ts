import { runMultiAgentWorkflow } from '@orot/agent-runtime';
import {
  providerSuccess,
  type LanguageModelRequest,
} from '@orot/model-runtime';
import { symptomSummaryTask } from '../symptomSummaryTask';
import { hypothesis, reference, workflowOptionsFor } from '../taskTestSupport';

/** Scripted responses establish bounded correction, not actual provider language quality. */
test.each([false, true])(
  'keeps one correction and coverage visible, repeated=%s',
  async repeated => {
    const section = hypothesis({
      title: '기록 요약',
      summary: '원문에 증상 경과가 기록되어 있어요.',
      supportingEvidence: [reference.evidenceId],
      missingData: [],
      uncertainty: '도구 결과 용량 제한으로 일부 정보를 포함하지 못했어요.',
    });
    const plain = '일부 요청한 정보는 이번 요약에 포함하지 못했어요.';
    const options = workflowOptionsFor({ sections: [section] });
    const requests: LanguageModelRequest[] = [];
    const generate = jest.fn(async (request: LanguageModelRequest) => {
      requests.push(request);
      return providerSuccess({
        text: JSON.stringify({
          type: 'result',
          value: {
            sections: [
              {
                ...section,
                uncertainty:
                  requests.length === 1 || repeated
                    ? section.uncertainty
                    : plain,
              },
            ],
          },
          citations: [reference.evidenceId],
        }),
        toolCalls: [],
        finishReason: 'complete' as const,
      });
    });
    const result = await runMultiAgentWorkflow({
      ...options,
      task: symptomSummaryTask,
      provider: { ...options.provider, generate },
    });
    expect(result.status).toBe(repeated ? 'invalid_output' : 'result');
    expect(requests).toHaveLength(2);
    expect(requests[1]!.tools).toBeUndefined();
    const correction = requests[1]!.messages.at(-1)!;
    if (correction.role !== 'user') throw new Error('Expected correction');
    expect(String(correction.content)).toContain(
      'Keep the summary explicitly partial',
    );
    if (result.status === 'result') {
      expect(result.value.hypotheses[0]!.uncertainty).toBe(plain);
      expect(result.value.hypotheses[0]!.summary).toBe(section.summary);
      expect(
        result.value.hypotheses[0]!.supportingEvidence[0]!.evidenceId,
      ).toBe(reference.evidenceId);
    }
  },
);
