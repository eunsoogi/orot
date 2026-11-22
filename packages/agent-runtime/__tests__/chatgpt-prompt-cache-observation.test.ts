import { providerSuccess, type LanguageModelProvider } from '@orot/model-runtime';
import { callModel } from '../src/multiAgent/modelCall';
import { createEuropePmcEvidenceSearchTool } from '../src';
import { makeProvider, workflowOptions } from './multiAgent-external-evidence-fixtures';

const counts = { inputTokens: 9, outputTokens: 1, totalTokens: 10 };
const request = { messages: [{ role: 'user' as const, content: 'Synthetic request' }] };
const tool = createEuropePmcEvidenceSearchTool({
  service: { search: async () => ({ status: 'available', publications: [] }) },
  consent: { authorize: async () => 'authorized' },
});

test.each([
  [undefined, 'unknown', false],
  [0, 'reported_zero', false],
  [9, 'reported_positive', true],
  [10, 'unknown', true],
])(
  'reports only provider-supplied closed cache states (%s, %s, streaming=%s)',
  async (cachedInputTokens, state, streaming) => {
    const { provider: base, generate } = makeProvider(['Synthetic fallback']);
    const usage = { ...counts, cachedInputTokens };
    const result = {
      text: 'Synthetic reply',
      toolCalls: [],
      finishReason: 'complete' as const,
      usage,
    };
    generate.mockResolvedValue(providerSuccess(result));
    const provider: LanguageModelProvider = {
      ...base,
      id: 'chatgpt-plan:synthetic-account:test-model',
      capabilities: { ...base.capabilities, streaming },
      ...(streaming
        ? {
            async *stream() {
              yield providerSuccess({ type: 'text_delta' as const, text: result.text });
              yield providerSuccess({ type: 'completed' as const, response: result });
            },
          }
        : {}),
    };
    const observer = jest.fn();
    await expect(
      callModel(
        provider,
        request,
        workflowOptions(provider, tool).execution,
        { authorize: async () => 'authorized' },
        new AbortController().signal,
        undefined,
        undefined,
        observer,
      ),
    ).resolves.toMatchObject({ status: 'response', response: result });
    expect(observer.mock.calls).toEqual([
      ['provider_wait', 'started'],
      ['chatgpt_prompt_cache_' + state, 'completed'],
      ['provider_wait', 'completed'],
    ]);
  },
);

test.each(['revocation', 'cancellation', 'different-provider'] as const)(
  'does not observe cache in %s',
  async (mode) => {
    const { provider: base, generate } = makeProvider(['Synthetic fallback']);
    const stop = new AbortController();
    let live = true;
    generate.mockImplementation(async () => {
      if (mode === 'revocation') live = false;
      if (mode === 'cancellation') stop.abort();
      return providerSuccess({
        text: 'Synthetic reply',
        toolCalls: [],
        finishReason: 'complete',
        usage: { ...counts, cachedInputTokens: 5 },
      });
    });
    const provider = {
      ...base,
      id:
        mode === 'different-provider'
          ? 'synthetic-other'
          : 'chatgpt-plan:synthetic-account:test-model',
    };
    const observer = jest.fn();
    const response = await callModel(
      provider,
      request,
      workflowOptions(provider, tool).execution,
      { authorize: async () => 'authorized', isAuthorizationCurrent: () => live },
      stop.signal,
      undefined,
      undefined,
      observer,
    );
    // The existing authorizer rejects terminal delivery on either lifetime loss.
    expect(response.status).toBe(mode === 'different-provider' ? 'response' : 'consent_required');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(observer.mock.calls).toEqual([
      ['provider_wait', 'started'],
      ['provider_wait', 'completed'],
    ]);
  },
);
