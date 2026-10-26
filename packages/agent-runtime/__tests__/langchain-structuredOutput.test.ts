import { AIMessage } from '@langchain/core/messages';
import type { LanguageModelProvider } from '@orot/model-runtime';
import { NativeChatModel } from '../src/langchain/chatModel';

const schema = {
  type: 'object',
  properties: { answer: { type: 'string' } },
  required: ['answer'],
  additionalProperties: false,
};

function fixture(supportsNative: boolean, text = '{"answer":"ok"}') {
  const generate = jest.fn().mockResolvedValue({
    ok: true,
    value: { text, toolCalls: [], finishReason: 'complete' },
  });
  const provider: LanguageModelProvider = {
    id: 'selected-provider',
    kind: 'language-model',
    displayName: 'Selected',
    capabilities: {
      inputTypes: ['text'],
      toolCalling: false,
      streaming: false,
      structuredOutput: supportsNative,
    },
    generate,
  };
  return { generate, model: new NativeChatModel(provider), provider };
}

describe('native chat structured output', () => {
  it('sends the schema through the native response-format channel when supported', async () => {
    const { generate, model } = fixture(true);
    generate.mockResolvedValue({
      ok: true,
      value: {
        text: '{"answer":"ok"}',
        structuredOutput: { answer: 'ok' },
        toolCalls: [],
        finishReason: 'complete',
      },
    });

    await expect(model.withStructuredOutput(schema).invoke('Question')).resolves.toEqual({
      answer: 'ok',
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0]).toEqual({
      messages: [{ role: 'user', content: 'Question' }],
      responseFormat: { name: 'structured_output', schema },
    });
    expect(generate.mock.calls[0][0]).not.toHaveProperty('tools');
  });

  it('uses a JSON instruction and local validation when native formatting is unavailable', async () => {
    const { generate, model } = fixture(false);

    await expect(model.withStructuredOutput(schema).invoke('Question')).resolves.toEqual({
      answer: 'ok',
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0]).toEqual({
      messages: [
        { role: 'system', content: expect.stringContaining(JSON.stringify(schema)) },
        { role: 'user', content: 'Question' },
      ],
    });
    expect(generate.mock.calls[0][0]).not.toHaveProperty('responseFormat');
    expect(generate.mock.calls[0][0]).not.toHaveProperty('tools');
  });

  it('rejects malformed JSON without retrying or exposing the model text', async () => {
    const privateText = 'PRIVATE_HEALTH_PAYLOAD';
    const { generate, model } = fixture(false, privateText);
    const error = await model
      .withStructuredOutput(schema)
      .invoke('Question')
      .catch((value) => value);

    expect(error).toMatchObject({ name: 'StructuredOutputError', code: 'invalid_output' });
    expect(String(error)).not.toContain(privateText);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('rejects schema-mismatched native output before returning it', async () => {
    const privateValue = { answer: 42 };
    const { generate, model } = fixture(true);
    generate.mockResolvedValue({
      ok: true,
      value: {
        text: JSON.stringify(privateValue),
        structuredOutput: privateValue,
        toolCalls: [],
        finishReason: 'complete',
      },
    });
    const error = await model
      .withStructuredOutput(schema)
      .invoke('Question')
      .catch((value) => value);

    expect(error).toMatchObject({ name: 'StructuredOutputError', code: 'invalid_output' });
    expect(String(error)).not.toContain('42');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('rejects forced native formatting when the provider does not declare it', () => {
    const { generate, model } = fixture(false);

    expect(() => model.withStructuredOutput(schema, { method: 'jsonSchema' })).toThrow(
      expect.objectContaining({ code: 'unsupported_capability' }),
    );
    expect(generate).not.toHaveBeenCalled();
  });

  it('rejects function-calling structured output without binding or dispatching tools', () => {
    const { generate, model } = fixture(true);

    expect(() => model.withStructuredOutput(schema, { method: 'functionCalling' })).toThrow(
      expect.objectContaining({ code: 'unsupported_capability' }),
    );
    expect(generate).not.toHaveBeenCalled();
  });

  it('supports the standard includeRaw result without changing the raw message contract', async () => {
    const { model } = fixture(true);
    const result = await model
      .withStructuredOutput(schema, { includeRaw: true })
      .invoke('Question');

    expect(result).toMatchObject({ parsed: { answer: 'ok' } });
    expect(result.raw).toBeInstanceOf(AIMessage);
    expect(result.raw.content).toBe('{"answer":"ok"}');
  });

  it('keeps callbacks and cancellation inside the adapter privacy boundary', async () => {
    const { generate, model } = fixture(true);
    const controller = new AbortController();
    const callbacks = {
      handleChainStart: jest.fn(),
      handleChainEnd: jest.fn(),
      handleChainError: jest.fn(),
      handleChatModelStart: jest.fn(),
      handleLLMEnd: jest.fn(),
      handleLLMError: jest.fn(),
    };
    generate.mockImplementationOnce(async (_request, options) => {
      expect(options.signal).toBe(controller.signal);
      controller.abort();
      return {
        ok: true,
        value: { text: '{"answer":"late"}', toolCalls: [], finishReason: 'complete' },
      };
    });

    await expect(
      model.withStructuredOutput(schema).invoke('PRIVATE_QUESTION', {
        callbacks: [callbacks],
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(Object.values(callbacks).every((callback) => callback.mock.calls.length === 0)).toBe(
      true,
    );
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('makes the API available to subclasses without changing their provider capability', async () => {
    class DerivedChatModel extends NativeChatModel {}
    const { provider } = fixture(false);
    const derived = new DerivedChatModel(provider);

    await expect(derived.withStructuredOutput(schema).invoke('Question')).resolves.toEqual({
      answer: 'ok',
    });
  });
});
