import { providerSuccess } from '@orot/model-runtime';
import type { LanguageModelProvider } from '@orot/model-runtime';
import {
  guardConversationHistoryProvider,
  guardHistory,
} from '../conversationHistoryProviderGuard';

test('rechecks before a streamed dispatch and leaves no-history execution unchanged', async () => {
  const stream = jest.fn(async function* () {
    yield providerSuccess({ type: 'text_delta' as const, text: 'synthetic' });
  });
  const provider: LanguageModelProvider = {
    kind: 'language-model',
    id: 'fixture',
    displayName: 'fixture',
    capabilities: {
      inputTypes: ['text'],
      streaming: true,
      structuredOutput: false,
      toolCalling: false,
    },
    generate: jest.fn(async () =>
      providerSuccess({
        text: 'ok',
        toolCalls: [],
        finishReason: 'complete' as const,
      }),
    ),
    stream,
  };
  const execution = { provider };
  expect(guardHistory(execution, () => false, false)).toBe(execution);
  const guarded = guardConversationHistoryProvider(provider, () => false);
  const events = [];
  for await (const event of guarded.stream!({ messages: [] }))
    events.push(event);
  expect(events).toEqual([expect.objectContaining({ ok: false })]);
  expect(stream).not.toHaveBeenCalled();
  const current = guardConversationHistoryProvider(provider, () => true);
  const currentEvents = [];
  for await (const event of current.stream!({ messages: [] }))
    currentEvents.push(event);
  expect(currentEvents).toEqual([
    providerSuccess({ type: 'text_delta', text: 'synthetic' }),
  ]);
  expect(stream).toHaveBeenCalledTimes(1);
  const controller = new AbortController();
  controller.abort();
  await guarded.generate({ messages: [] }, { signal: controller.signal });
  expect(provider.generate).not.toHaveBeenCalled();
});
