import { NativeModules } from 'react-native';
import { createChatGPTPlanProvider } from '@orot/provider-openai';
import { createProductionChatModel } from '@orot/agent-runtime';
import {
  chatGPTPlanNativeBridge,
  listOpenAIPlanModels,
} from '../src/providers/openai';

interface Fixture {
  prepareSyntheticFixture(
    scenario: string,
  ): Promise<{ issuedClientID: string }>;
  removeSyntheticFixture(): Promise<void>;
}

/** Count real native-module dispatches and observe native events; no JS bridge result is replaced. */
export async function runStandardAdaptersOpenAIProbe() {
  const fixture = NativeModules.OpenAIProviderModule as Fixture | undefined;
  if (!fixture)
    throw new Error('Standard adapters require the native OpenAI fixture');
  let dispatches = 0;
  let cancellation: AbortController | undefined;
  let cancellationEvents = 0;
  let toolExecutions = 0;
  let callbackEvents = 0;
  const callback = () => {
    callbackEvents += 1;
  };
  const callbacks = [
    {
      handleChatModelStart: callback,
      handleLLMEnd: callback,
      handleLLMNewToken: callback,
    },
  ];
  try {
    const account = await fixture.prepareSyntheticFixture('adapterCompleted');
    const catalog = await listOpenAIPlanModels(account.issuedClientID);
    if (!catalog.ok || catalog.value.length !== 1)
      throw new Error('Native fixture catalog missing');
    const provider = createChatGPTPlanProvider({
      issuedClientID: account.issuedClientID,
      model: catalog.value[0]!,
      bridge: {
        ...chatGPTPlanNativeBridge,
        async startResponse(id, client, request) {
          dispatches += 1;
          return chatGPTPlanNativeBridge.startResponse(id, client, request);
        },
        subscribe(listener) {
          return chatGPTPlanNativeBridge.subscribe(event => {
            if (cancellation && event.type === 'text_delta') {
              cancellationEvents += 1;
              cancellation.abort();
            }
            listener(event);
          });
        },
      },
    });
    const model = createProductionChatModel(provider);
    const plain = await model.invoke('Synthetic invoke', { callbacks });
    if (
      dispatches !== 1 ||
      plain.content !== '안녕하세요' ||
      plain.usage_metadata?.total_tokens !== 10 ||
      plain.usage_metadata.input_tokens !== 7 ||
      plain.usage_metadata.output_tokens !== 3
    )
      throw new Error('Native invoke lost dispatch identity or reported usage');
    const chunks = [];
    for await (const part of await model.stream('Synthetic final stream', {
      callbacks,
    }))
      chunks.push(part);
    if (
      Number(dispatches) !== 2 ||
      chunks.length !== 1 ||
      chunks[0]?.content !== '안녕하세요' ||
      chunks[0]?.usage_metadata?.total_tokens !== 10
    )
      throw new Error('Standard stream did not terminate with final usage');
    await fixture.prepareSyntheticFixture('toolRoundTrip');
    const tool = {
      type: 'function' as const,
      function: {
        name: 'lookup_source',
        description: 'Look up one synthetic source.',
        parameters: {
          type: 'object',
          properties: { sourceId: { type: 'string' } },
          required: ['sourceId'],
          additionalProperties: false,
        },
      },
      invoke: () => {
        toolExecutions += 1;
      },
    };
    const bound = model.bindTools([tool]);
    const toolChunks = [];
    for await (const part of await bound.stream('Look up source-42.', {
      callbacks,
    }))
      toolChunks.push(part);
    const call = toolChunks[0]?.tool_calls?.[0];
    if (
      Number(dispatches) !== 3 ||
      toolChunks.length !== 1 ||
      call?.id !== 'call_synthetic_source' ||
      call.name !== 'lookup_source' ||
      call.args.sourceId !== 'source-42' ||
      toolExecutions !== 0
    )
      throw new Error('Native tool identity changed or tooling ran implicitly');
    for (const streaming of [false, true]) {
      await fixture.prepareSyntheticFixture('cancellable');
      cancellation = new AbortController();
      let rejected = false;
      try {
        if (streaming) {
          for await (const part of await model.stream(
            'Synthetic cancellation',
            { signal: cancellation.signal, callbacks },
          )) {
            throw new Error(
              'Buffered cancellation published output of type ' + part.type,
            );
          }
        } else
          await model.invoke('Synthetic cancellation', {
            signal: cancellation.signal,
            callbacks,
          });
      } catch (error) {
        rejected = error instanceof Error && error.name === 'AbortError';
      }
      cancellation = undefined;
      if (!rejected)
        throw new Error(
          'Native event cancellation did not reject the standard API',
        );
    }
    if (
      Number(dispatches) !== 5 ||
      cancellationEvents !== 2 ||
      callbackEvents !== 0
    )
      throw new Error('Native dispatch, cancellation or privacy count changed');
    return {
      dispatches,
      cancellationEvents,
      callbackEvents,
      toolExecutions,
      toolCallId: call.id,
      usage: plain.usage_metadata,
      inferenceStop: 'unverified',
    };
  } finally {
    await fixture.removeSyntheticFixture();
  }
}
