import { useEffect, useState } from 'react';
import type {
  LanguageModelRequest,
  LanguageModelStreamEvent,
  ProviderResult,
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
const request: LanguageModelRequest = {
  messages: [{ role: 'user', content: '인사해 주세요.' }],
};

export function OpenAIProviderProbe() {
  const [result, setResult] = useState('ChatGPT plan provider probe running');

  useEffect(() => {
    runProbe().then(
      () =>
        setResult(
          'ChatGPT plan provider synthetic probe passed: catalog=visible-model-only, terminal=completed, usageLimit=rate_limited, cancellation=resolved, realAccount=unverified',
        ),
      (error: unknown) => {
        const detail =
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error);
        console.error('OpenAI provider Simulator probe failed:', error);
        setResult('ChatGPT plan provider probe failed: ' + detail);
      },
    );
  }, []);

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" testID="openai-provider-probe-result">
        {result}
      </Text>
    </View>
  );
}

async function runProbe() {
  let fixtureInstalled = false;
  try {
    const fixture = await fixtureModule.prepareSyntheticFixture('completed');
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

    const completion = provider.stream!(request)[Symbol.asyncIterator]();
    expectDelta(await completion.next(), '안녕');
    expectDelta(await completion.next(), '하세요');
    expectCompletion(await completion.next(), '안녕하세요');
    if (!(await completion.next()).done)
      throw new Error('The completed stream yielded another event.');

    await fixtureModule.prepareSyntheticFixture('usageLimit');
    const limited = provider.stream!(request)[Symbol.asyncIterator]();
    expectDelta(await limited.next(), '일부');
    const failure = await limited.next();
    if (
      failure.done ||
      failure.value.ok ||
      failure.value.error.code !== 'rate_limited'
    ) {
      throw new Error(
        'The plan usage failure was not surfaced as rate_limited.',
      );
    }

    await fixtureModule.prepareSyntheticFixture('cancellable');
    const cancellable = provider.stream!(request)[Symbol.asyncIterator]();
    expectDelta(await cancellable.next(), '취소 대기');
    if (!cancellable.return)
      throw new Error(
        'The provider stream does not support consumer cancellation.',
      );
    if (!(await cancellable.return()).done)
      throw new Error('Consumer cancellation did not close the stream.');
  } finally {
    if (fixtureInstalled) await fixtureModule.removeSyntheticFixture();
  }
}

function expectDelta(
  event: IteratorResult<ProviderResult<LanguageModelStreamEvent>>,
  text: string,
) {
  if (
    event.done ||
    !event.value.ok ||
    event.value.value.type !== 'text_delta' ||
    event.value.value.text !== text
  ) {
    throw new Error(
      'Expected text delta ' +
        JSON.stringify(text) +
        ', received ' +
        JSON.stringify(event) +
        '.',
    );
  }
}

function expectCompletion(
  event: IteratorResult<ProviderResult<LanguageModelStreamEvent>>,
  text: string,
) {
  if (
    event.done ||
    !event.value.ok ||
    event.value.value.type !== 'completed' ||
    event.value.value.response.text !== text
  ) {
    throw new Error(
      'Expected completed response ' + JSON.stringify(text) + '.',
    );
  }
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
