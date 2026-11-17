import { conversationReceiptSelection } from '../conversationReceiptSelection';
import { resolveConversationSelection } from '../conversationVoiceSelection';
import type { SelectedAiResolution } from '../provider';

function fixture(remoteProcessing = true) {
  const generate = jest.fn(async () => ({ status: 'unavailable' }));
  const provider = { id: 'synthetic', generate };
  return {
    generate,
    selected: {
      status: 'ready',
      provider,
      option: { provider },
      modelId: 'synthetic',
      remoteProcessing,
    } as unknown as Extract<SelectedAiResolution, { status: 'ready' }>,
  };
}

// These are the common boundaries used by visit/report/summary and ordinary chat.
// A synthetic dispatch observation is not proof of iOS scheduler admission.
test.each(['direct', 'option'] as const)(
  '%s provider requests remote execution only at actual dispatch without a receipt observer',
  async path => {
    const f = fixture();
    const onExecutionState = jest.fn();
    const selected = conversationReceiptSelection(f.selected, {
      onExecutionState,
    });
    expect(onExecutionState).not.toHaveBeenCalled();
    const provider =
      path === 'direct' ? selected.provider : selected.option.provider;
    await provider.generate({} as never);
    expect(onExecutionState.mock.calls).toEqual([['working']]);
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(selected.provider).toBe(selected.option.provider);
  },
);

test('ordinary chat keeps direct and option providers identical without duplicate work signals', async () => {
  const f = fixture();
  const onExecutionState = jest.fn();
  const selected = await resolveConversationSelection(
    { onExecutionState },
    async () => f.selected,
  );
  expect(selected!.provider).toBe(selected!.option.provider);
  await selected!.provider.generate({} as never);
  expect(onExecutionState.mock.calls).toEqual([['working']]);
});

test('local processing and already-aborted dispatch never request remote background admission', async () => {
  const f = fixture(false);
  const onExecutionState = jest.fn();
  const selected = conversationReceiptSelection(f.selected, {
    onExecutionState,
  });
  await selected.option.provider.generate({} as never);
  expect(onExecutionState.mock.calls).toEqual([['local']]);
  const controller = new AbortController();
  controller.abort();
  await selected.provider.generate({} as never, { signal: controller.signal });
  expect(onExecutionState.mock.calls).toEqual([['local']]);
});
