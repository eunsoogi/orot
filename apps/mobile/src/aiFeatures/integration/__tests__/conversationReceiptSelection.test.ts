import { providerSuccess } from '@orot/model-runtime';
import type {
  LanguageModelExecutionOptions,
  LanguageModelProvider,
} from '@orot/model-runtime';
import { conversationReceiptSelection } from '../conversationReceiptSelection';
import { resolveConversationSelection } from '../conversationVoiceSelection';
import type { SelectedAiResolution } from '../provider';

function fixture() {
  let started!: () => void;
  let finish!: () => void;
  const provider = {
    kind: 'language-model',
    id: 'synthetic',
    capabilities: {},
    generate: jest.fn(
      async (_request, options?: LanguageModelExecutionOptions) => {
        started = () => options?.onResponseStarted?.();
        await new Promise<void>(resolve => {
          finish = resolve;
        });
        return providerSuccess({
          text: 'Synthetic final',
          toolCalls: [],
          finishReason: 'complete',
        });
      },
    ),
  } as unknown as LanguageModelProvider;
  const selected = {
    status: 'ready',
    provider,
    option: { provider },
    modelId: 'synthetic',
    remoteProcessing: false,
  } as Extract<SelectedAiResolution, { status: 'ready' }>;
  return { selected, start: () => started(), finish: () => finish() };
}
const request = { messages: [], model: 'synthetic' } as never;

test.each(['direct', 'option'])(
  '%s selected provider reports actual processing before any output',
  async path => {
    const f = fixture();
    const onProviderReceipt = jest.fn();
    const selected = conversationReceiptSelection(f.selected, {
      onProviderReceipt,
    });
    expect(selected.provider).toBe(selected.option.provider);
    expect(onProviderReceipt).not.toHaveBeenCalled();
    const provider =
      path === 'option' ? selected.option.provider : selected.provider;
    const pending = provider.generate(request);
    f.start();
    expect(onProviderReceipt).toHaveBeenCalledWith('response_started');
    expect(onProviderReceipt).toHaveBeenCalledTimes(1);
    f.finish();
    await pending;
    expect(onProviderReceipt).toHaveBeenCalledTimes(1);
    expect(f.selected.provider).not.toBe(selected.provider);
  },
);

test('ordinary conversation and follow-up selection preserve processing observations', async () => {
  const f = fixture();
  const onProviderReceipt = jest.fn();
  const selected = await resolveConversationSelection(
    { onProviderReceipt },
    async () => f.selected,
  );
  const pending = selected!.provider.generate(request);
  f.start();
  expect(onProviderReceipt).toHaveBeenCalledWith('response_started');
  f.finish();
  await pending;
});

test('aborted processing callback and unsupported selection cannot fabricate read', async () => {
  const f = fixture();
  const onProviderReceipt = jest.fn();
  const controller = new AbortController();
  const selected = conversationReceiptSelection(f.selected, {
    onProviderReceipt,
  });
  const pending = selected.option.provider.generate(request, {
    signal: controller.signal,
  });
  controller.abort();
  f.start();
  f.finish();
  await pending;
  expect(onProviderReceipt).not.toHaveBeenCalled();
  expect(
    conversationReceiptSelection(
      { status: 'unavailable' },
      { onProviderReceipt },
    ),
  ).toEqual({ status: 'unavailable' });
});

test("separate requests cannot receive each other's processing event", async () => {
  const a = fixture();
  const b = fixture();
  const first = jest.fn();
  const second = jest.fn();
  const one = conversationReceiptSelection(a.selected, {
    onProviderReceipt: first,
  });
  const two = conversationReceiptSelection(b.selected, {
    onProviderReceipt: second,
  });
  const pendingOne = one.provider.generate(request);
  const pendingTwo = two.option.provider.generate(request);
  a.start();
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).not.toHaveBeenCalled();
  b.start();
  expect(second).toHaveBeenCalledTimes(1);
  a.finish();
  b.finish();
  await Promise.all([pendingOne, pendingTwo]);
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
});

test('provider failure before processing evidence does not mark read', async () => {
  const f = fixture();
  jest
    .mocked(f.selected.provider.generate)
    .mockRejectedValue(new Error('synthetic failure'));
  const onProviderReceipt = jest.fn();
  const selected = conversationReceiptSelection(f.selected, {
    onProviderReceipt,
  });
  await expect(selected.option.provider.generate(request)).rejects.toThrow(
    'synthetic failure',
  );
  expect(onProviderReceipt).not.toHaveBeenCalled();
});
