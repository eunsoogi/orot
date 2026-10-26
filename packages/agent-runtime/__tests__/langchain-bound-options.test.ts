import {
  providerSuccess,
  type LanguageModelProvider,
  type LanguageModelRequest,
} from '@orot/model-runtime';
import { NativeStreamingChatModel } from '../src/langchain/streaming';
import type { StructuredOutputSchema } from '../src/langchain/structuredOutput';

const schema = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] };
const tool = {
  type: 'function' as const,
  function: { name: 'lookup', parameters: { type: 'object', properties: {} } },
};
const response = { text: '{"answer":"valid"}', toolCalls: [], finishReason: 'complete' as const };
function fixture() {
  const generate = jest.fn(async (_request: LanguageModelRequest) => providerSuccess(response));
  const provider: LanguageModelProvider = {
    id: 'synthetic',
    kind: 'language-model',
    displayName: 'Synthetic',
    capabilities: {
      inputTypes: ['text'],
      toolCalling: true,
      structuredOutput: true,
      streaming: true,
    },
    generate,
  };
  return { provider, generate };
}

it('applies a bound response format to plain invoke before native dispatch', async () => {
  const { provider, generate } = fixture();
  const format = { name: 'answer', schema };
  const bound = new NativeStreamingChatModel(provider, 'buffered').bindTools([tool], {
    responseFormat: format,
  });
  await bound.invoke('Question');
  expect(generate.mock.calls[0]?.[0].responseFormat).toEqual(format);
  expect(generate).toHaveBeenCalledTimes(1);
});

it('does not pull upstream after a bound signal aborts between append-only chunks', async () => {
  const { provider } = fixture();
  const controller = new AbortController();
  let reads = 0;
  provider.stream = async function* () {
    reads += 1;
    yield providerSuccess({ type: 'text_delta', text: response.text });
    reads += 1;
    yield providerSuccess({ type: 'completed', response });
  };
  const bound = new NativeStreamingChatModel(provider, 'append-only').bindTools([tool], {
    signal: controller.signal,
  });
  const iterator = (await bound.stream('Question'))[Symbol.asyncIterator]();
  await iterator.next();
  controller.abort();
  await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' });
  expect(reads).toBe(1);
});

it('keeps a bound signal active while public structured-output parsing finishes', async () => {
  const { provider } = fixture();
  const controller = new AbortController();
  let finishParse!: (value: unknown) => void;
  let startedParse!: () => void;
  const parsing = new Promise<void>((resolve) => {
    startedParse = resolve;
  });
  const runtimeSchema = {
    '~standard': {
      version: 1,
      vendor: 'orot-test',
      jsonSchema: { input: () => schema },
      validate: async () => {
        startedParse();
        return new Promise<unknown>((resolve) => {
          finishParse = resolve;
        });
      },
    },
  } as unknown as StructuredOutputSchema<{ answer: string }>;
  const bound = new NativeStreamingChatModel(provider, 'buffered').bindTools([tool], {
    signal: controller.signal,
  });
  const pending = bound.withStructuredOutput(runtimeSchema).invoke('Question');
  await parsing;
  controller.abort();
  finishParse({ value: { answer: 'valid' } });
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
});
