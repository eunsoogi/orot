import type { LanguageModelRequest } from '@orot/model-runtime';
import { appleModelMockScript } from '../e2e/appleModelMockFixtures';

const allowedCitationReferencesPrefix =
  'Allowed citation references (return citations as their evidenceId strings; do not invent IDs):\n';

const tools = [
  {
    name: 'europe-pmc-publication-search',
    inputSchema: {
      type: 'object' as const,
      properties: { query: { type: 'string' } },
    },
  },
];

test('tool-enabled visit replies use the native mixed-response envelope', () => {
  const input = { ...request(['evidence-alias-7']), tools };
  const output = JSON.parse(
    appleModelMockScript('apple-workflow')[1](input).text!,
  );
  expect(output.kind).toBe('structured');
  expect(output.value.citations).toEqual(['evidence-alias-7']);
});

test.each([undefined, 'required'] as const)(
  'empty-library literature probe chooses a protocol call with toolChoice=%s',
  toolChoice => {
    const script = appleModelMockScript('rag-workflow');
    const input = {
      ...request([]),
      tools,
      ...(toolChoice ? { toolChoice } : {}),
    };
    expect(JSON.parse(script[0](input).text!)).toEqual({
      kind: 'tool_calls',
      toolCalls: [
        {
          name: tools[0].name,
          arguments: { query: '(sleep duration adults) AND HAS_ABSTRACT:y' },
        },
      ],
    });
    expect(script).toHaveLength(2);
  },
);

function request(ids: string[]): LanguageModelRequest {
  return {
    messages: [
      {
        role: 'user',
        content: allowedCitationReferencesPrefix + JSON.stringify(ids),
      },
    ],
    responseFormat: {
      name: 'task_response',
      schema: {
        anyOf: [
          { properties: {} },
          { properties: { citations: { items: { type: 'string' } } } },
        ],
      },
    },
  };
}

test('three Calendar examples remain distinct across both imports', () => {
  const script = appleModelMockScript('calendar-classification');
  expect(script).toHaveLength(2);
  const input = request([
    'calendar-candidate-1',
    'calendar-candidate-2',
    'calendar-candidate-3',
  ]);
  for (const step of script) {
    const output = JSON.parse(step(input).text!);
    expect(output.citations).toEqual([
      'calendar-candidate-1',
      'calendar-candidate-2',
      'calendar-candidate-3',
    ]);
    expect(
      output.value.classifications.map(
        (value: { decision: string }) => value.decision,
      ),
    ).toEqual(['medical_low', 'non_medical_low', 'uncertain_high']);
  }
  expect(() => script[0](request(['missing-candidate']))).toThrow(
    'every original candidate',
  );
});

test('visit fixture keeps supplied aliases and a delayed cancellation request', () => {
  const script = appleModelMockScript('apple-workflow');
  const output = JSON.parse(script[1](request(['evidence-alias-7'])).text!);
  expect(output.citations).toEqual(['evidence-alias-7']);
  expect(output.value.questions).toHaveLength(3);
  for (const question of output.value.questions) {
    expect(question.evidenceIds).toEqual(['evidence-alias-7']);
    expect(question.questionText).toMatch(/\?$/);
  }
  expect(script[2](request(['evidence-alias-7'])).delayMs).toBe(250);
  expect(() => script[1](request([]))).toThrow('supplied citation IDs');
});

test('literature fixture reads citation IDs from the prompt allowlist without a schema enum', () => {
  const script = appleModelMockScript('rag-workflow');
  expect(() => script[0](request([]))).toThrow('supplied publication tool');
  const taskRequest = request([
    'returned-publication-1',
    'returned-publication-2',
  ]);
  const taskSchema = taskRequest.responseFormat!.schema as {
    anyOf: readonly { properties?: { citations?: { items?: object } } }[];
  };
  expect(taskSchema.anyOf[1].properties?.citations?.items).toEqual({
    type: 'string',
  });
  const output = JSON.parse(script[1](taskRequest).text!);
  expect(output.citations).toEqual(['returned-publication-1']);
  expect(output.value.answer).toContain('mock');
  expect(() => script[1](request([]))).toThrow('supplied citation IDs');
});

test('unknown operations and unexpected format fail instead of returning a generic successful response', () => {
  expect(() => appleModelMockScript('unknown')).toThrow('Unknown');
  expect(() => appleModelMockScript('apple-model')[0](request([]))).toThrow(
    'Unexpected model request format',
  );
});
