import type {
  LanguageModelProvider,
  LanguageModelStreamEvent,
  ProviderResult,
} from '@orot/model-runtime';
import { conversationReceiptProvider } from '../conversationReceiptProvider';
const response = (text = '') => ({
  text,
  toolCalls: [],
  finishReason: 'complete' as const,
});
const provider = (
  events: readonly ProviderResult<LanguageModelStreamEvent>[] = [],
) =>
  ({
    id: 'synthetic',
    kind: 'language-model',
    displayName: 'Synthetic',
    capabilities: {},
    generate: jest.fn(async () => ({ ok: true, value: response() })),
    stream: jest.fn(async function* () {
      yield* events;
    }),
  }) as unknown as LanguageModelProvider;

test('does not mark dispatch, empty fragments or failures as read and preserves provider results', async () => {
  const failure = {
    ok: false as const,
    error: {
      code: 'internal_error' as const,
      message: 'Synthetic',
      retryable: false,
    },
  };
  const events: ProviderResult<LanguageModelStreamEvent>[] = [
    { ok: true, value: { type: 'text_delta', text: '' } },
    failure,
  ];
  const observe = jest.fn();
  const wrapped = conversationReceiptProvider(provider(events), observe);
  const stream = wrapped.stream!({ messages: [] });
  expect(observe).not.toHaveBeenCalled();
  const actual = [];
  for await (const event of stream) actual.push(event);
  expect(actual).toEqual(events);
  expect(observe).not.toHaveBeenCalled();
});

test('empty successful response proves acceptance, and first actual output advances once to read', async () => {
  const observe = jest.fn();
  const events: ProviderResult<LanguageModelStreamEvent>[] = [
    { ok: true, value: { type: 'text_delta', text: 'Synthetic output' } },
    { ok: true, value: { type: 'text_delta', text: 'Repeated' } },
    { ok: true, value: { type: 'completed', response: response('Complete') } },
  ];
  const wrapped = conversationReceiptProvider(provider(events), observe);
  await wrapped.generate({ messages: [] });
  expect(observe.mock.calls).toEqual([['accepted']]);
  for await (const _ of wrapped.stream!({ messages: [] })) {
    expect(_.ok).toBe(true);
  }
  expect(observe.mock.calls).toEqual([['accepted'], ['response_started']]);
});

test('aborted late results and public search never create a chat receipt', async () => {
  const observe = jest.fn();
  const controller = new AbortController();
  controller.abort();
  const search = jest.fn(async () => ({
    ok: true as const,
    value: { text: 'Synthetic', callCount: 1, citations: [] },
  }));
  const wrapped = conversationReceiptProvider(
    {
      ...provider([{ ok: true, value: { type: 'text_delta', text: 'Late' } }]),
      searchPublicWeb: search,
    },
    observe,
  );
  await wrapped.generate({ messages: [] }, { signal: controller.signal });
  for await (const _ of wrapped.stream!(
    { messages: [] },
    { signal: controller.signal },
  )) {
    expect(_.ok).toBe(true);
  }
  await wrapped.searchPublicWeb!(
    { query: 'synthetic topic' },
    { signal: new AbortController().signal },
  );
  expect(observe).not.toHaveBeenCalled();
});

test('observer exceptions do not change the provider result', async () => {
  const wrapped = conversationReceiptProvider(provider(), () => {
    throw new Error('Synthetic observer failure');
  });
  await expect(wrapped.generate({ messages: [] })).resolves.toEqual({
    ok: true,
    value: response(),
  });
});

test('an actual provider tool-call response proves response started without claiming tool success', async () => {
  const observe = jest.fn();
  const tool = {
    id: 'synthetic-call',
    name: 'synthetic_tool',
    arguments: {},
  };
  const wrapped = conversationReceiptProvider(
    provider([{ ok: true, value: { type: 'tool_call', toolCall: tool } }]),
    observe,
  );
  for await (const _ of wrapped.stream!({ messages: [] })) {
    expect(_.ok).toBe(true);
  }
  expect(observe.mock.calls).toEqual([['response_started']]);
});
