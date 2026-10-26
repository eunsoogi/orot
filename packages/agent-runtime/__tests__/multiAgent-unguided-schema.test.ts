import type { JsonObject, LanguageModelProvider } from '@orot/model-runtime';
import { DEFAULT_MULTI_AGENT_BUDGET } from '../src';
import { buildTaskRequest } from '../src/multiAgent/requests';
import { taskResponseSchema } from '../src/multiAgent/protocol';

const task = {
  taskType: 'synthetic-answer',
  taskVersion: '1',
  systemPrompt: 'Answer the supplied task.',
  resultSchema: {
    type: 'object',
    required: ['answer'],
    properties: { answer: { type: 'string' } },
    additionalProperties: false,
  } as JsonObject,
  createMessages: () => [{ role: 'user' as const, content: 'Synthetic question' }],
  validateResult: (value: unknown) => ({ status: 'valid' as const, value }),
};
const input = {
  request: 'Synthetic question',
  evidence: { items: [], coverage: [], conflicts: [] },
};

function provider(structuredOutput: boolean, toolCalling: boolean): LanguageModelProvider {
  return {
    kind: 'language-model',
    id: 'fixture',
    displayName: 'Fixture',
    capabilities: { inputTypes: ['text'], streaming: true, structuredOutput, toolCalling },
    generate: async () => {
      throw new Error('No provider call is needed to inspect its request.');
    },
  };
}

test.each([false, true])(
  'non-guided responders receive the actual result envelope and task schema, tools=%s',
  async (native) => {
    const research = native
      ? {
          candidateTools: [
            {
              id: 'records',
              sourceKind: 'personal_record' as const,
              execution: 'local_read_only' as const,
            },
          ],
        }
      : undefined;
    // A full research descriptor is unnecessary here: native selection only depends on candidate tools.
    const requestInput = {
      ...input,
      ...(research
        ? {
            research: {
              ...research,
              canRequestEvidence: true,
              allowedScope: { sourceKinds: ['personal_record' as const] },
              remainingResearchCycles: 1,
              remainingModelCalls: 2,
              remainingToolCalls: 1,
            },
          }
        : {}),
    };
    const built = await buildTaskRequest(
      provider(false, native),
      task,
      requestInput,
      DEFAULT_MULTI_AGENT_BUDGET,
    );
    if (built.status !== 'ready') throw new Error('Expected a valid request.');
    const promptObjects = built.request.messages.flatMap((message) => {
      if (message.role !== 'user' || typeof message.content !== 'string') return [];
      try {
        return [JSON.parse(message.content)];
      } catch {
        return [];
      }
    });
    const format = promptObjects.find((object) => object?.responseSchema);
    expect(format?.responseSchema).toEqual(taskResponseSchema(task, requestInput, native));
    expect(built.request.responseFormat).toBeUndefined();
    expect(JSON.stringify(format?.responseSchema)).toContain('"answer"');
    if (native) expect(JSON.stringify(format?.responseSchema)).not.toContain('request_evidence');
  },
);

test('native structured output retains its schema channel without a duplicate schema prompt', async () => {
  const built = await buildTaskRequest(
    provider(true, false),
    task,
    input,
    DEFAULT_MULTI_AGENT_BUDGET,
  );
  if (built.status !== 'ready') throw new Error('Expected a valid request.');
  expect(built.request.responseFormat?.schema).toEqual(taskResponseSchema(task, input));
  expect(
    built.request.messages.some(
      (message) =>
        typeof message.content === 'string' && message.content.includes('"responseSchema"'),
    ),
  ).toBe(false);
});
