import { providerSuccess } from '@orot/model-runtime';
import type { LanguageModelRequest } from '@orot/model-runtime';
import { createAppointmentClassificationTask } from '../classificationTask';
import { classifyCalendarEvents } from '../classificationWorkflow';
import {
  event,
  input,
  makeProvider,
  workflowResponse,
} from '../classificationWorkflowTestFixtures';

test('constrains generation to the exact batch size and candidate identities', () => {
  const ids = ['calendar-candidate-17', 'calendar-candidate-18'];
  const task = createAppointmentClassificationTask(ids);
  expect(task.resultSchema).toMatchObject({
    properties: {
      classifications: {
        minItems: 2,
        maxItems: 2,
        items: {
          properties: { candidateId: { enum: ids }, reason: { minLength: 1 } },
        },
      },
    },
  });
});

test('corrects an incomplete classification once and keeps the same scoped candidates', async () => {
  const generate = jest.fn(async (request: LanguageModelRequest) =>
    workflowResponse(request),
  );
  generate.mockImplementationOnce(async request => {
    const result = workflowResponse(request);
    if (!result.ok) throw new Error('Expected fixture output.');
    const output = JSON.parse(result.value.text);
    output.value.classifications.pop();
    return providerSuccess({ ...result.value, text: JSON.stringify(output) });
  });
  const result = await classifyCalendarEvents(
    input([event(0), event(1)], { provider: makeProvider(generate) }),
  );
  expect(result.status).toBe('complete');
  expect(result.candidates).toHaveLength(2);
  expect(generate).toHaveBeenCalledTimes(2);
  expect(generate.mock.calls[1]?.[0].messages[1]).toEqual(
    generate.mock.calls[0]?.[0].messages[1],
  );
  expect(JSON.stringify(generate.mock.calls[1]?.[0].messages)).toContain(
    'Every supplied candidate',
  );
});

test('reports a fixed identity failure category without including calendar payloads', async () => {
  const generate = jest.fn(async (request: LanguageModelRequest) => {
    const result = workflowResponse(request);
    if (!result.ok) throw new Error('Expected fixture output.');
    const output = JSON.parse(result.value.text);
    output.value.classifications[1].candidateId =
      output.value.classifications[0].candidateId;
    return providerSuccess({ ...result.value, text: JSON.stringify(output) });
  });
  const result = await classifyCalendarEvents(
    input([event(0), event(1)], { provider: makeProvider(generate) }),
  );
  expect(result.status).toBe('unavailable');
  expect(result.failure?.detail).toBe(
    'A candidate identity was repeated or unknown.',
  );
  expect(JSON.stringify(result.failure)).not.toContain('private-calendar');
  expect(generate).toHaveBeenCalledTimes(2);
});

test('offers only a final result schema when classification has no research tools', async () => {
  const generate = jest.fn(async (request: LanguageModelRequest) =>
    workflowResponse(request),
  );
  const provider = makeProvider(generate);
  await classifyCalendarEvents(
    input([event(0)], {
      provider: {
        ...provider,
        capabilities: { ...provider.capabilities, structuredOutput: true },
      },
    }),
  );
  expect(generate.mock.calls[0]?.[0].responseFormat?.schema).toMatchObject({
    type: 'object',
  });
  expect(
    JSON.stringify(generate.mock.calls[0]?.[0].responseFormat?.schema),
  ).not.toContain('request_evidence');
});
