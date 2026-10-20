import { runMultiAgentWorkflow } from '@orot/agent-runtime';
import {
  providerSuccess,
  type LanguageModelRequest,
} from '@orot/model-runtime';
import { diseaseHypothesisTask } from '../task';
import {
  evidence,
  hypothesis,
  reference,
  workflowOptionsFor,
} from '../taskTestSupport';

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

test('sends the rejected field to correction without adding private validation text', () => {
  const value = {
    hypotheses: [hypothesis({ uncertainty: '진단되었습니다.' })],
  };
  const validation = diseaseHypothesisTask.validateResult(value, {
    request: '합성 가능성 검토',
    evidence,
  });
  expect(validation.status).toBe('invalid');
  if (validation.status !== 'invalid') throw new Error('Expected rejection');
  expect(validation.reason).toBe(
    'A hypothesis contained a definitive clinical claim in uncertainty.',
  );
  const instruction =
    diseaseHypothesisTask.correctionInstructionForInvalidResult?.(
      validation.reason,
    );
  expect(instruction).toContain('The rejected field is uncertainty.');
  expect(instruction).toContain('measurement conditions');
  expect(instruction).not.toContain('진단되었습니다.');
  expect(
    diseaseHypothesisTask.correctionInstructionForInvalidResult?.(
      'unknown private output',
    ),
  ).toBeUndefined();
});
