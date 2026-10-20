import { runMultiAgentWorkflow } from '@orot/agent-runtime';
import {
  providerSuccess,
  type LanguageModelRequest,
} from '@orot/model-runtime';
import { symptomSummaryTask } from '../symptomSummaryTask';
import {
  evidence,
  hypothesis,
  reference,
  workflowOptionsFor,
} from '../taskTestSupport';

test('corrects an untranslated uncertainty without dropping facts, citations or requesting another search', async () => {
  const section = hypothesis({
    supportingEvidence: [reference.evidenceId],
    uncertainty: 'None',
    missingData: [],
  });
  const value = { sections: [section] };
  const correctedSection = {
    ...Object.fromEntries(
      Object.entries(section).filter(([key]) => key !== 'uncertainty'),
    ),
    uncertaintyNotes: [],
  };
  const options = workflowOptionsFor(value);
  const requests: LanguageModelRequest[] = [];
  const generate = jest.fn(async (request: LanguageModelRequest) => {
    requests.push(request);
    return providerSuccess({
      text: JSON.stringify({
        type: 'result',
        value: requests.length === 1 ? value : { sections: [correctedSection] },
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
  expect(result.status).toBe('result');
  if (result.status === 'result')
    expect(result.value.hypotheses[0]?.uncertainty).toBe('');
  expect(requests).toHaveLength(2);
  const correction = requests[1]!;
  const instruction = correction.messages.at(-1)!;
  if (instruction.role !== 'user')
    throw new Error('Expected correction instruction');
  expect(instruction.content).toContain('uncertainty');
  expect(instruction.content).toContain('empty array');
  expect(instruction.content).toContain(
    'Keep valid facts and citation IDs unchanged',
  );
  expect(correction.tools).toBeUndefined();
  const previous = correction.messages.at(-2)!;
  expect(previous.role).toBe('assistant');
  if (previous.role !== 'assistant')
    throw new Error('Expected rejected assistant answer');
  expect(JSON.parse(previous.content as string).value).toEqual(value);
  expect(
    symptomSummaryTask.validateResult(value, { request: '합성 요약', evidence })
      .status,
  ).toBe('invalid');
});

test('guided uncertainty describes Korean notes and an empty array when no limitation applies', () => {
  const schema = symptomSummaryTask.resultSchema as {
    properties: {
      sections: {
        items: { properties: { uncertaintyNotes: { description?: string } } };
      };
    };
  };
  const uncertainty =
    schema.properties.sections.items.properties.uncertaintyNotes;
  expect(uncertainty.description).toContain('Korean');
  expect(uncertainty.description).toContain('empty array');
});
