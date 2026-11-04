import { providerSuccess } from '@orot/model-runtime';
import { runMultiAgentWorkflow } from '@orot/agent-runtime';
import { symptomSummaryTask } from '../symptomSummaryTask';
import { hypothesis, reference, workflowOptionsFor } from '../taskTestSupport';

const section = hypothesis({
  title: '기록된 증상',
  summary: '원문에 증상 경과가 기록되어 있어요.',
  supportingEvidence: [reference.evidenceId],
});

function response(citations: string[]) {
  return providerSuccess({
    text: JSON.stringify({
      type: 'result',
      value: { sections: [section] },
      citations,
    }),
    toolCalls: [],
    finishReason: 'complete' as const,
  });
}

test('retries an invalid envelope once and accepts only a corrected current citation', async () => {
  const options = workflowOptionsFor({ sections: [section] });
  const generate = jest
    .fn()
    .mockResolvedValueOnce(response([reference.evidenceId, 'unknown']))
    .mockResolvedValueOnce(response([reference.evidenceId]));
  const result = await runMultiAgentWorkflow({
    ...options,
    provider: { ...options.provider, generate },
    task: symptomSummaryTask,
  });
  expect(generate).toHaveBeenCalledTimes(2);
  expect(result.status).toBe('result');
  if (result.status === 'result') expect(result.citations).toEqual([reference]);
});

test('rejects an envelope that still cites an unknown source after correction', async () => {
  const options = workflowOptionsFor({ sections: [section] });
  const generate = jest.fn(async () =>
    response([reference.evidenceId, 'unknown']),
  );
  const result = await runMultiAgentWorkflow({
    ...options,
    provider: { ...options.provider, generate },
    task: symptomSummaryTask,
  });
  expect(generate).toHaveBeenCalledTimes(2);
  expect(result.status).toBe('invalid_output');
});
