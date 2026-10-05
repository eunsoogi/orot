import { useEffect, useState } from 'react';
import type {
  LanguageModelRequest,
  LanguageModelStreamEvent,
  ProviderResult,
  ToolCall,
} from '@orot/model-runtime';
import { NativeModules, StyleSheet, Text, View } from 'react-native';
import type { ChatGPTPlanModelDescriptor } from '@orot/provider-openai';
import {
  createOpenAIPlanProvider,
  listOpenAIPlanModels,
} from '../src/providers/openai';

interface OpenAIProbeModule {
  prepareSyntheticFixture(
    scenario: string,
  ): Promise<{ readonly issuedClientID: string }>;
  removeSyntheticFixture(): Promise<void>;
}

const fixtureModule = NativeModules.OpenAIProviderModule as OpenAIProbeModule;
const tool = {
  name: 'lookup_source',
  description: 'Look up one synthetic source.',
  inputSchema: {
    type: 'object',
    properties: { sourceId: { type: 'string' } },
    required: ['sourceId'],
    additionalProperties: false,
  },
} as const;
const firstRequest: LanguageModelRequest = {
  messages: [{ role: 'user', content: 'Look up source-42.' }],
  tools: [tool],
};

export function OpenAIToolsProviderProbe() {
  const [result, setResult] = useState('ChatGPT local tool probe running');

  useEffect(() => {
    runProbe().then(
      () =>
        setResult(
          'ChatGPT local tool probe passed: definitions=mapped, stream=normalized, result=round-trip, hostedTools=rejected, realAccount=unverified',
        ),
      (error: unknown) => {
        const detail =
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error);
        console.error('OpenAI local tool Simulator probe failed:', error);
        setResult('ChatGPT local tool probe failed: ' + detail);
      },
    );
  }, []);

  return (
    <View style={styles.container}>
      <Text
        accessibilityRole="header"
        testID="openai-tools-provider-probe-result"
      >
        {result}
      </Text>
    </View>
  );
}

async function runProbe() {
  let fixtureInstalled = false;
  try {
    const fixture =
      await fixtureModule.prepareSyntheticFixture('toolRoundTrip');
    fixtureInstalled = true;
    const catalog = await listOpenAIPlanModels(fixture.issuedClientID);
    if (!catalog.ok)
      throw new Error('Model discovery failed: ' + catalog.error.message);
    if (
      catalog.value.length !== 1 ||
      catalog.value[0]?.slug !== 'gpt-synthetic'
    ) {
      throw new Error(
        'Model discovery did not keep only the visible synthetic model.',
      );
    }
    const model: ChatGPTPlanModelDescriptor = catalog.value[0];
    const provider = createOpenAIPlanProvider(fixture.issuedClientID, model);
    const hostedRequest = {
      ...firstRequest,
      tools: [{ ...tool, type: 'web_search' }],
    } as unknown as LanguageModelRequest;
    const hostedResult = await provider.generate(hostedRequest);
    if (
      hostedResult.ok ||
      hostedResult.error.code !== 'unsupported_capability'
    ) {
      throw new Error('A hosted tool request was not explicitly rejected.');
    }

    const firstStream = provider.stream!(firstRequest)[Symbol.asyncIterator]();
    const callEvent = expectToolCall(await firstStream.next());
    if (
      callEvent.name !== tool.name ||
      callEvent.arguments.sourceId !== 'source-42'
    ) {
      throw new Error(
        'The streamed function call did not preserve its normalized fields.',
      );
    }
    const completion = expectCompletion(await firstStream.next());
    if (
      completion.toolCalls.length !== 1 ||
      completion.toolCalls[0]?.id !== callEvent.id
    ) {
      throw new Error(
        'The completed response did not retain the streamed function call.',
      );
    }
    if (!(await firstStream.next()).done)
      throw new Error('The first response stream yielded after completion.');

    const localResult = { found: true, sourceId: callEvent.arguments.sourceId };
    const followUp: LanguageModelRequest = {
      messages: [
        { role: 'user', content: 'Look up source-42.' },
        {
          role: 'assistant',
          content: completion.text,
          toolCalls: completion.toolCalls,
        },
        { role: 'tool', toolCallId: callEvent.id, result: localResult },
      ],
      tools: [tool],
    };
    const final = await provider.generate(followUp);
    if (!final.ok)
      throw new Error(
        'The model rejected the local function result: ' + final.error.message,
      );
    if (
      final.value.text !== 'Source found.' ||
      final.value.toolCalls.length !== 0
    ) {
      throw new Error(
        'The model did not finish after receiving the local function result.',
      );
    }
  } finally {
    if (fixtureInstalled) await fixtureModule.removeSyntheticFixture();
  }
}

function expectToolCall(
  event: IteratorResult<ProviderResult<LanguageModelStreamEvent>>,
): ToolCall {
  if (event.done || !event.value.ok || event.value.value.type !== 'tool_call') {
    throw new Error(
      'Expected a normalized streamed tool call, received ' +
        JSON.stringify(event) +
        '.',
    );
  }
  return event.value.value.toolCall;
}

function expectCompletion(
  event: IteratorResult<ProviderResult<LanguageModelStreamEvent>>,
) {
  if (event.done || !event.value.ok || event.value.value.type !== 'completed') {
    throw new Error(
      'Expected a completed tool-call response, received ' +
        JSON.stringify(event) +
        '.',
    );
  }
  return event.value.value.response;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#f7f8fa',
  },
});
