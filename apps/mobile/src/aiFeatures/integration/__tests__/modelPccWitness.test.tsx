import { act, render, screen } from '@testing-library/react-native';
import { APPLE_PCC_PROVIDER_ID } from '@orot/provider-apple';
import { providerSelectionStore } from '../../../providers/selection/keychainSelectionStore';
import { APPLE_PCC_MODEL_ID } from '../../../providers/selection/privateCloudCompute';
import type { ProviderSelectionOption } from '../../../providers/selection/types';
import * as execution from '../../../ragConversation/conversationExecutionNative';
import type { ConversationExecutionEvent } from '../../../ragConversation/conversationExecutionLease';
import { AiProviderSelectorRow } from '../AiProviderSelectorRow';
import { resolveSelectedAiProvider } from '../provider';

jest.mock('../../../layout/AppSymbol', () => ({ AppSymbol: () => null }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { resolve, promise };
}

test.each([
  'missing native protection',
  'missing selection witness',
  'stale protection after background',
] as const)('never publishes PCC presentation with %s', async scenario => {
  const selected = {
    providerId: APPLE_PCC_PROVIDER_ID,
    modelId: APPLE_PCC_MODEL_ID,
  };
  const name = 'Apple Intelligence';
  const generate = jest.fn();
  const option: ProviderSelectionOption = {
    provider: {
      id: selected.providerId,
      kind: 'language-model',
      displayName: name,
      capabilities: {
        inputTypes: ['text'],
        streaming: true,
        structuredOutput: true,
        toolCalling: true,
      },
      generate,
    },
    modelId: selected.modelId,
    displayName: name,
    privacyBoundary: 'selected-context-remote',
    availability: { status: 'available' },
  };
  const firstAvailability = deferred<ProviderSelectionOption>();
  const secondAvailability = deferred<ProviderSelectionOption>();
  const loadPccOption = jest
    .fn()
    .mockReturnValueOnce(firstAvailability.promise)
    .mockReturnValue(secondAvailability.promise);
  const firstProtection = deferred<boolean>();
  const nextProtection = deferred<boolean>();
  const protectedDataAvailable = jest
    .fn()
    .mockReturnValueOnce(firstProtection.promise)
    .mockReturnValue(nextProtection.promise);
  let nativeEvent = (_event: ConversationExecutionEvent) => {};
  const close = jest.fn();
  jest.spyOn(providerSelectionStore, 'load').mockResolvedValue(selected);
  jest
    .spyOn(providerSelectionStore, 'liveWitness')
    .mockImplementation(() => () => true);
  jest.spyOn(providerSelectionStore, 'subscribeChanges').mockReturnValue(close);
  jest.spyOn(execution, 'conversationExecutionNative').mockReturnValue({
    bridgeAvailable: scenario !== 'missing native protection',
    currentPhase: () => 'active',
    begin: jest.fn(async () => true),
    end: jest.fn(),
    isActive: jest.fn(async () => true),
    protectedDataAvailable,
    subscribe(listener) {
      nativeEvent = listener;
      return close;
    },
  });
  try {
    const view = await render(
      <AiProviderSelectorRow
        onPress={jest.fn()}
        revision={0}
        resolveSelectedAi={observer =>
          resolveSelectedAiProvider(
            {
              ...(scenario === 'missing selection witness'
                ? {
                    selectionStore: {
                      load: () => providerSelectionStore.load(),
                      save: jest.fn(),
                      clear: jest.fn(),
                    },
                  }
                : {}),
              loadPccOption,
            },
            observer,
          )
        }
      />,
    );
    const emit = (event: ConversationExecutionEvent) =>
      act(async () => nativeEvent(event));
    const title = () => screen.queryByText(name);
    const busy = () =>
      screen.getByTestId('ai-feature-select-provider').props.accessibilityState
        .busy;
    expect(loadPccOption).toHaveBeenCalledTimes(1);
    expect(title()).toBeNull();
    if (scenario === 'stale protection after background') {
      expect(protectedDataAvailable).toHaveBeenCalledTimes(1);
      await emit({ kind: 'phase' });
      await emit({ kind: 'foreground' });
      expect(protectedDataAvailable).toHaveBeenCalledTimes(2);
      // Both values from the old episode arrive while new protection is unproven.
      await act(async () => firstProtection.resolve(true));
      await act(async () => firstAvailability.resolve(option));
      expect(title()).toBeNull();
      expect(loadPccOption).toHaveBeenCalledTimes(1);
      await act(async () => nextProtection.resolve(true));
      expect(title()).toBeTruthy();
      expect(busy()).toBe(true);
      expect(loadPccOption).toHaveBeenCalledTimes(2);
      await act(async () => secondAvailability.resolve(option));
      expect(title()).toBeTruthy();
      expect(busy()).toBe(false);
    } else {
      await emit({ kind: 'phase' });
      await act(async () => firstAvailability.resolve(option));
      expect(title()).toBeNull();
      await emit({ kind: 'foreground' });
      expect(title()).toBeNull();
      expect(busy()).toBe(false);
      expect(loadPccOption).toHaveBeenCalledTimes(1);
      expect(protectedDataAvailable).not.toHaveBeenCalled();
    }
    expect(generate).not.toHaveBeenCalled();
    await view.unmount();
  } finally {
    jest.restoreAllMocks();
  }
});
