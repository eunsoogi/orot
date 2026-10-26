import { describe, expect, it } from '@jest/globals';

const {
  createOpenAIChatCompletionsProvider,
} = require('../../../scripts/evaluation/visit-questions/openai-api-provider.cjs');

describe('bounded synthetic OpenAI response delay', () => {
  it('accepts a mocked response that arrives after Jest’s default five-second timeout', async () => {
    const { provider, getTokenUsage } = createOpenAIChatCompletionsProvider({
      apiKey: 'synthetic-test-key',
      model: 'model-test',
      fetchImpl: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5_500));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: 'done' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }),
        };
      },
    });

    const response = await provider.generate({
      messages: [{ role: 'user', content: 'synthetic input' }],
    });

    expect(response).toMatchObject({ ok: true, value: { text: 'done' } });
    expect(getTokenUsage()).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  }, 15_000);
});
