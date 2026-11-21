import { act, render, screen } from '@testing-library/react-native';
import { providerSelectionStore } from '../../../providers/selection/keychainSelectionStore';
import { createAppleSelectionOption } from '../../../providers/selection/options';
import * as nativeExecution from '../../../ragConversation/conversationExecutionNative';
import { AiProviderSelectorRow } from '../AiProviderSelectorRow';
import { resolveSelectedAiProvider } from '../provider';
import type { ProviderSelectionOption } from '../../../providers/selection/types';

afterEach(() => jest.restoreAllMocks());

it.each(['disabled', 'modelNotReady', 'unsupportedLanguage'] as const)(
  'preserves the exact saved local name and native %s reason without granting readiness',
  async reason => {
    const option = createAppleSelectionOption(reason);
    if (option.availability.status !== 'unavailable')
      throw new Error('Fixture');
    jest.spyOn(providerSelectionStore, 'load').mockResolvedValue({
      providerId: option.provider.id,
      modelId: option.modelId,
    });
    jest
      .spyOn(providerSelectionStore, 'liveWitness')
      .mockReturnValue(() => true);
    jest.spyOn(nativeExecution, 'conversationExecutionNative').mockReturnValue({
      bridgeAvailable: true,
      currentPhase: () => 'active',
      begin: jest.fn(),
      end: jest.fn(),
      isActive: jest.fn(),
      protectedDataAvailable: async () => true,
      subscribe: () => () => undefined,
    });
    let release!: (value: ProviderSelectionOption) => void;
    const held = new Promise<ProviderSelectionOption>(resolve => {
      release = resolve;
    });
    await render(
      <AiProviderSelectorRow
        onPress={jest.fn()}
        revision={1}
        resolveSelectedAi={display =>
          resolveSelectedAiProvider({ loadAppleOption: () => held }, display)
        }
      />,
    );
    expect(await screen.findByText('Apple Intelligence')).toBeTruthy();
    expect(screen.getByTestId('ai-feature-select-provider')).toBeBusy();
    await act(() => release(option));
    expect(screen.getByText('Apple Intelligence')).toBeTruthy();
    expect(screen.getByText(option.availability.message)).toBeTruthy();
    expect(screen.getByTestId('ai-feature-select-provider')).not.toBeBusy();
    await expect(
      resolveSelectedAiProvider({ loadAppleOption: async () => option }),
    ).resolves.toEqual({ status: 'unavailable' });
  },
);
