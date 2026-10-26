import type {
  LanguageModelProvider,
  LanguageModelStreamEvent,
  ProviderResult,
} from '@orot/model-runtime';
import { NativeStreamingChatModel } from '../src/langchain/streaming';

function event(value: LanguageModelStreamEvent): ProviderResult<LanguageModelStreamEvent> {
  return { ok: true, value };
}

function fixture(
  source: AsyncIterable<ProviderResult<LanguageModelStreamEvent>>,
): LanguageModelProvider {
  return {
    id: 'synthetic-provider',
    kind: 'language-model',
    displayName: 'Synthetic provider',
    capabilities: {
      inputTypes: ['text'],
      streaming: true,
      structuredOutput: false,
      toolCalling: false,
      requestControls: [],
    },
    generate: async () => ({
      ok: true,
      value: { text: '', toolCalls: [], finishReason: 'complete' },
    }),
    stream: () => source,
  };
}

async function consume(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const chunk of stream) {
    expect(chunk).toBeDefined();
  }
}

describe('native chat streaming error boundaries', () => {
  it('classifies contradictory streamed tool calls without leaking a type error', async () => {
    const provider = fixture(
      (async function* () {
        yield event({
          type: 'tool_call',
          toolCall: { id: 'call-1', name: 'lookup', arguments: {} },
        });
        yield event({
          type: 'completed',
          response: { text: '', toolCalls: [], finishReason: 'complete' },
        });
      })(),
    );

    await expect(
      consume(await new NativeStreamingChatModel(provider, 'append-only').stream('Question')),
    ).rejects.toMatchObject({ code: 'internal_error' });
  });

  it('sanitizes provider-thrown abort errors when the caller has not aborted', async () => {
    const provider = fixture(
      (async function* () {
        throw Object.assign(new Error('private provider diagnostic'), { name: 'AbortError' });
      })(),
    );

    const error = await consume(
      await new NativeStreamingChatModel(provider, 'append-only').stream('Question'),
    ).catch((failure: unknown) => failure);

    expect(error).toMatchObject({ name: 'AbortError' });
    expect((error as Error).message).not.toContain('private provider diagnostic');
  });
});
