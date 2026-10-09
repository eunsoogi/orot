import { describe, expect, it } from '@jest/globals';

const {
  mapRequest,
} = require('../../../scripts/evaluation/visit-questions/openai-api-provider.cjs');

describe('OpenAI structured response instructions', () => {
  it('passes the graph response schema to the model alongside JSON mode', () => {
    const schema = {
      oneOf: [
        {
          type: 'object',
          properties: {
            questionText: { type: 'string' },
            rationale: { type: 'string' },
            priority: { enum: ['high', 'medium', 'low'] },
            suggestions: { type: 'array', items: { type: 'object' } },
          },
        },
      ],
    };
    const request = {
      messages: [{ role: 'system', content: 'synthetic instructions' }],
      responseFormat: { name: 'task_response', schema },
    };

    const mapped = mapRequest('model-test', request);

    expect(mapped.response_format).toEqual({ type: 'json_object' });
    expect(mapped.messages[0].content).toContain(JSON.stringify(schema));
    expect(mapped.messages[0].content).toContain('questionText');
  });
});
