import type { LanguageModelRequest } from '@orot/model-runtime';
import { appleModelMockScript } from '../e2e/appleModelMockFixtures';

function request(ids: string[]): LanguageModelRequest {
  return {
    messages: [{ role: 'user', content: 'synthetic contract input' }],
    responseFormat: {
      name: 'task_response',
      schema: {
        anyOf: [
          { properties: {} },
          { properties: { citations: { items: { enum: ids } } } },
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
        (value: { classification: string }) => value.classification,
      ),
    ).toEqual(['medical', 'non_medical', 'uncertain']);
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

test('literature fixture requests the allowlisted public query before citing retrieved evidence', () => {
  const script = appleModelMockScript('rag-workflow');
  expect(JSON.parse(script[0](request([])).text!)).toEqual({
    type: 'request_evidence',
    need: 'missing_coverage',
  });
  const planner = {
    ...request([]),
    responseFormat: { name: 'evidence_research_plan', schema: {} },
  };
  expect(JSON.parse(script[1](planner).text!)).toEqual({
    toolId: 'europe-pmc-publication-search',
    sourceKind: 'external_medical',
    input: { query: 'sleep duration adults' },
  });
  const output = JSON.parse(
    script[2](request(['returned-publication-1', 'returned-publication-2']))
      .text!,
  );
  expect(output.citations).toEqual(['returned-publication-1']);
  expect(output.value.answer).toContain('mock');
  expect(() => script[2](request([]))).toThrow('supplied citation IDs');
});

test('unknown operations and unexpected format fail instead of returning a generic successful response', () => {
  expect(() => appleModelMockScript('unknown')).toThrow('Unknown');
  expect(() => appleModelMockScript('apple-model')[0](request([]))).toThrow(
    'Unexpected model request format',
  );
});
