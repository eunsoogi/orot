import { AppleFoundationModelsProvider } from '../src';
import { FakeNativeBridge } from './providerTestSupport';
import { AppleToolLifetime } from '../src/toolLifetime';

const request = { messages: [{ role: 'user' as const, content: 'Search.' }] };
const toolResponse = {
  text: '',
  toolCalls: [{ id: 'bridge-owned-call', name: 'search', arguments: { query: 'test' } }],
  finishReason: 'tool_calls' as const,
};

test.each(['tool_call', 'text_delta'] as const)(
  'closing after %s cancels before ownership transfer',
  async (eventType) => {
    const bridge = new FakeNativeBridge();
    bridge.packets = [
      {
        type: 'completed',
        response: {
          ...toolResponse,
          text: eventType === 'text_delta' ? 'provisional' : '',
        },
      },
    ];
    const controller = new AbortController();
    const stream = new AppleFoundationModelsProvider(bridge).stream(request, {
      signal: controller.signal,
    });
    const first = await stream.next();
    expect(first.value).toMatchObject({ ok: true, value: { type: eventType } });
    await stream.return(undefined);
    expect(bridge.cancelled).toHaveLength(1);
    controller.abort();
    expect(bridge.cancelled).toHaveLength(1);
  },
);

// A completed bridge reply can still own an SDK callback awaiting a validated tool result.
test.each(['generate', 'stream'] as const)(
  '%s retains cancellation after a tool reply',
  async (mode) => {
    const bridge = new FakeNativeBridge();
    bridge.generated = toolResponse;
    bridge.packets = [{ type: 'completed', response: toolResponse }];
    const cancel = jest.spyOn(bridge, 'cancel');
    const controller = new AbortController();
    const provider = new AppleFoundationModelsProvider(bridge);
    if (mode === 'generate') await provider.generate(request, { signal: controller.signal });
    else
      for await (const event of provider.stream(request, { signal: controller.signal })) {
        expect(event.ok).toBe(true);
      }
    expect(cancel).not.toHaveBeenCalled();
    controller.abort();
    expect(cancel).toHaveBeenCalledTimes(1);
  },
);

test('releases a previous callback after its matching result finishes', async () => {
  const bridge = new FakeNativeBridge();
  bridge.generated = toolResponse;
  const controller = new AbortController();
  const provider = new AppleFoundationModelsProvider(bridge);
  await provider.generate(request, { signal: controller.signal });
  bridge.generated = { text: 'done', toolCalls: [], finishReason: 'complete' };
  await provider.generate(
    {
      messages: [
        ...request.messages,
        { role: 'assistant', content: '', toolCalls: toolResponse.toolCalls },
        { role: 'tool', toolCallId: 'bridge-owned-call', result: { found: true } },
      ],
    },
    { signal: controller.signal },
  );
  controller.abort();
  expect(bridge.cancelled).toEqual([]);
});

test('bounds an orphaned callback and releases it exactly once', () => {
  jest.useFakeTimers();
  try {
    const cancel = jest.fn();
    const lifetime = new AppleToolLifetime(cancel);
    lifetime.begin(request)(toolResponse, 'request-1');
    jest.advanceTimersByTime(90_000);
    jest.advanceTimersByTime(90_000);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith('request-1');
  } finally {
    jest.useRealTimers();
  }
});

test('rejects another run consuming a callback and cleans up a failed continuation', () => {
  const cancel = jest.fn();
  const lifetime = new AppleToolLifetime(cancel);
  const owner = new AbortController();
  const other = new AbortController();
  lifetime.begin(request, owner.signal)(toolResponse, 'request-1');
  const followup = {
    messages: [{ role: 'tool' as const, toolCallId: 'bridge-owned-call', result: {} }],
  };
  expect(() => lifetime.begin(followup, other.signal)).toThrow('another Apple run');
  expect(cancel).not.toHaveBeenCalled();
  lifetime.begin(followup, owner.signal)();
  owner.abort();
  expect(cancel).toHaveBeenCalledTimes(1);
});
