import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessageChunk, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { LanguageModelProvider, ProviderErrorCode } from '@orot/model-runtime';
import { NativeChatModel, NativeChatModelError } from '../src/langchain/chatModel';

function fixture() {
  const generate = jest.fn().mockResolvedValue({
    ok: true,
    value: { text: 'Answer', toolCalls: [], finishReason: 'complete' },
  });
  const provider: LanguageModelProvider = {
    id: 'selected-provider',
    kind: 'language-model',
    displayName: 'Selected',
    capabilities: {
      inputTypes: ['text'],
      toolCalling: false,
      streaming: false,
      structuredOutput: false,
    },
    generate,
  };
  return { provider, generate, model: new NativeChatModel(provider) };
}

describe('native chat invocation', () => {
  it('uses the selected provider exactly once per invoke, even for identical prompts', async () => {
    const { model, generate, provider } = fixture();
    expect(model).toBeInstanceOf(BaseChatModel);
    const capabilities = { ...provider.capabilities };
    const input = [new SystemMessage('Instructions'), new HumanMessage('Question')];
    for (let count = 1; count <= 2; count++) {
      const response = await model.invoke(input);
      expect(response).toBeInstanceOf(AIMessageChunk);
      expect(response.content).toBe('Answer');
      expect(response.response_metadata.finish_reason).toBe('complete');
      expect(generate).toHaveBeenCalledTimes(count);
    }
    expect(generate.mock.calls[0][0]).toEqual({
      messages: [
        { role: 'system', content: 'Instructions' },
        { role: 'user', content: 'Question' },
      ],
    });
    expect(provider.capabilities).toEqual(capabilities);
    expect(model.bindTools).toBeUndefined();
    expect(() => model.withStructuredOutput({ type: 'object' })).toThrow();
  });

  it('supports standard prompt values and preserves normalized returned tool calls', async () => {
    const { model, generate } = fixture();
    generate.mockResolvedValue({
      ok: true,
      value: {
        text: '',
        toolCalls: [{ id: 'call', name: 'search', arguments: { query: 'records' } }],
        finishReason: 'tool_calls',
      },
    });
    const prompt = ChatPromptTemplate.fromMessages([['human', '{question}']]);
    const response = await model.invoke(await prompt.invoke({ question: 'Question' }));
    expect(response.tool_calls).toEqual([
      { type: 'tool_call', id: 'call', name: 'search', args: { query: 'records' } },
    ]);
    expect(response.response_metadata.finish_reason).toBe('tool_calls');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0]).not.toHaveProperty('tools');
  });

  it.each<ProviderErrorCode>([
    'authentication_required',
    'credential_unavailable',
    'duplicate_provider',
    'internal_error',
    'invalid_provider',
    'invalid_request',
    'provider_unavailable',
    'rate_limited',
    'safety_refusal',
    'unsupported_capability',
    'unsupported_input',
  ])('maps %s without retrying or leaking diagnostics', async (code) => {
    const { model, generate } = fixture();
    generate.mockResolvedValue({
      ok: false,
      error: { code, retryable: true, message: 'private diagnostic' },
    });
    const error = await model.invoke('Question').catch((value: unknown) => value);
    expect(error).toBeInstanceOf(NativeChatModelError);
    expect(error).toMatchObject({ code, retryable: true });
    expect(JSON.stringify(error)).not.toContain('private diagnostic');
    expect((error as Error).message).not.toContain('private diagnostic');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('maps thrown transport errors while preserving AbortError', async () => {
    const { model, generate } = fixture();
    generate.mockRejectedValueOnce(new Error('private transport payload'));
    await expect(model.invoke('Question')).rejects.toMatchObject({
      code: 'internal_error',
      retryable: false,
    });
    const abort = Object.assign(new Error('Cancelled'), { name: 'AbortError' });
    generate.mockRejectedValueOnce(abort);
    await expect(model.invoke('Question')).rejects.toBe(abort);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('forwards cancellation and suppresses a late result after cancellation', async () => {
    const { model, generate } = fixture();
    const controller = new AbortController();
    generate.mockImplementationOnce(async (_request, options) => {
      expect(options.signal).toBe(controller.signal);
      controller.abort();
      return { ok: true, value: { text: 'Late', toolCalls: [], finishReason: 'complete' } };
    });
    await expect(model.invoke('Question', { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    await expect(model.invoke('Question', { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported options and controls before dispatch', async () => {
    const { model, generate } = fixture();
    for (const options of [
      { tool_choice: 'any' },
      { stop: ['stop'] },
      { timeout: 10 },
      { maxOutputTokens: 20 },
      { temperature: 0 },
      { tools: [] },
      { response_format: {} },
    ]) {
      await expect(model.invoke('Question', options)).rejects.toMatchObject({
        code: 'unsupported_capability',
      });
    }
    expect(generate).not.toHaveBeenCalled();
  });

  it('passes supported controls without adding tools, formats or public search', async () => {
    const { model, provider, generate } = fixture();
    Object.assign(provider.capabilities, { requestControls: ['temperature', 'maxOutputTokens'] });
    await model.invoke('Question', { maxOutputTokens: 20, temperature: 0 });
    expect(generate.mock.calls[0][0]).toEqual({
      messages: [{ role: 'user', content: 'Question' }],
      maxOutputTokens: 20,
      temperature: 0,
    });
  });

  it('keeps prompts and responses out of model callback telemetry', async () => {
    const { model, generate } = fixture();
    const handleChatModelStart = jest.fn();
    const handleLLMEnd = jest.fn();
    const handleLLMError = jest.fn();
    await model.invoke('Private question', {
      callbacks: [{ handleChatModelStart, handleLLMEnd, handleLLMError }],
    });
    expect(handleChatModelStart).not.toHaveBeenCalled();
    expect(handleLLMEnd).not.toHaveBeenCalled();
    expect(handleLLMError).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it.each(['complete', 'length_limit', 'content_filtered', 'tool_calls'])(
    'preserves the %s finish reason',
    async (finishReason) => {
      const { model, generate } = fixture();
      generate.mockResolvedValue({ ok: true, value: { text: '', toolCalls: [], finishReason } });
      await expect(model.invoke('Question')).resolves.toMatchObject({
        content: '',
        response_metadata: { finish_reason: finishReason },
      });
      expect(generate).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects unsupported message input before dispatch', async () => {
    const { model, generate } = fixture();
    await expect(
      model.invoke([
        new HumanMessage({
          content: [{ type: 'image_url', image_url: 'https://example.test/image' }],
        }),
      ]),
    ).rejects.toMatchObject({ name: 'MessageConversionError' });
    expect(generate).not.toHaveBeenCalled();
  });
});
