import { describe, expect, it } from '@jest/globals';

const {
  createOpenAIChatCompletionsProvider,
} = require('../../../scripts/evaluation/visit-questions/openai-api-provider.cjs');

function makeResponse(usage: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
      usage,
    }),
  };
}

describe('in-flight provider token usage', () => {
  it('keeps an earlier subtotal unmeasured while a later request is pending', async () => {
    let resolvePending!: (response: unknown) => void;
    let callCount = 0;
    const { provider, getTokenUsage } = createOpenAIChatCompletionsProvider({
      apiKey: 'synthetic-test-key',
      model: 'model-test',
      fetchImpl: async () => {
        callCount += 1;
        if (callCount === 1)
          return makeResponse({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
        return new Promise((resolve) => {
          resolvePending = resolve;
        });
      },
    });
    const request = { messages: [{ role: 'user', content: 'synthetic' }] };

    await provider.generate(request);
    const pendingResponse = provider.generate(request);
    const usageBeforeSecondResponse = getTokenUsage();
    resolvePending(makeResponse({ prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }));
    await pendingResponse;

    expect(usageBeforeSecondResponse).toBeNull();
    expect(getTokenUsage()).toEqual({ inputTokens: 12, outputTokens: 8, totalTokens: 20 });
  });
});
