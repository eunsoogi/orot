import { AsyncLocalStorage } from 'node:async_hooks';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { registerConfigureHook, setContextVariable } from '@langchain/core/context';
import { AsyncLocalStorageProviderSingleton } from '@langchain/core/singletons';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import { InMemoryFakeLanguageModelProvider } from '@orot/model-runtime';
import { NativeChatModel } from '../src/langchain/chatModel';

// Local-only recording exercises the library's real ambient propagation without a remote tracer.
class Recorder extends BaseCallbackHandler {
  name = 'synthetic-chat-recorder';
  events: unknown[] = [];
  handleChatModelStart(...args: unknown[]) {
    this.events.push(args);
  }
  handleLLMEnd(...args: unknown[]) {
    this.events.push(args);
  }
  handleLLMError(...args: unknown[]) {
    this.events.push(args);
  }
}

describe('native chat ambient telemetry boundary', () => {
  it('suppresses ambient payload tracing with a positive control', async () => {
    const recorder = new Recorder();
    const key = 'synthetic-private-chat-hook';
    registerConfigureHook({ contextVar: key, inheritable: true });
    AsyncLocalStorageProviderSingleton.initializeGlobalInstance(new AsyncLocalStorage());
    await AsyncLocalStorageProviderSingleton.runWithConfig({}, async () => {
      setContextVariable(key, recorder);
      try {
        await new FakeListChatModel({ responses: ['SYNTHETIC_PRIVATE_ANSWER'] }).invoke(
          'SYNTHETIC_PRIVATE_QUESTION',
        );
        expect(JSON.stringify(recorder.events)).toContain('SYNTHETIC_PRIVATE_QUESTION');
        expect(JSON.stringify(recorder.events)).toContain('SYNTHETIC_PRIVATE_ANSWER');
        recorder.events = [];
        const model = new NativeChatModel(new InMemoryFakeLanguageModelProvider());
        const response = await model.invoke('SYNTHETIC_PRIVATE_QUESTION');
        expect(response.content).toContain('SYNTHETIC_PRIVATE_QUESTION');
        expect(recorder.events).toEqual([]);
      } finally {
        setContextVariable(key, undefined);
      }
    });
  });
});
