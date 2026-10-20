import { runMultiAgentWorkflow } from '@orot/agent-runtime';
import {
  providerSuccess,
  type LanguageModelRequest,
} from '@orot/model-runtime';
import { diseaseHypothesisTask } from '../task';
import { hypothesis, reference, workflowOptionsFor } from '../taskTestSupport';

test.each([true, false])(
  'makes one bounded correction, corrected=%s',
  async corrected => {
    const invalid = {
      hypotheses: [hypothesis({ summary: 'You definitely have diabetes.' })],
    };
    const valid = { hypotheses: [hypothesis()] };
    const options = workflowOptionsFor(invalid);
    const requests: LanguageModelRequest[] = [];
    const result = await runMultiAgentWorkflow({
      ...options,
      task: diseaseHypothesisTask,
      provider: {
        ...options.provider,
        generate: async request => {
          requests.push(request);
          return providerSuccess({
            text: JSON.stringify({
              type: 'result',
              value: requests.length > 1 && corrected ? valid : invalid,
              citations: [reference.evidenceId],
            }),
            toolCalls: [],
            finishReason: 'complete',
          });
        },
      },
    });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.tools).toBeUndefined();
    expect(result.status).toBe(corrected ? 'result' : 'invalid_output');
    if (result.status === 'result') {
      expect(result.value.hypotheses[0]?.summary).toBe(hypothesis().summary);
      expect(result.citations).toEqual([reference]);
    }
  },
);
