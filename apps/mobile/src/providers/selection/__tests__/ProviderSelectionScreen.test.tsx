import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { providerSuccess } from '@orot/model-runtime';
import type { LanguageModelProvider } from '@orot/model-runtime';
import ProviderSelectionScreen from '../ProviderSelectionScreen';
import { providerSelectionText } from '../text';
import type { ProviderSelectionOption, ProviderSelectionStore } from '../types';

const requirements = { inputTypes: ['text'] as const, toolCalling: true };

function makeOption(
  id: string,
  privacyBoundary: ProviderSelectionOption['privacyBoundary'],
  availability: ProviderSelectionOption['availability'] = {
    status: 'available',
  },
): ProviderSelectionOption {
  const provider: LanguageModelProvider = {
    kind: 'language-model',
    id,
    displayName: id,
    capabilities: {
      inputTypes: ['text'],
      streaming: true,
      structuredOutput: privacyBoundary === 'on-device',
      toolCalling: true,
    },
    generate: async () =>
      providerSuccess({
        text: '질문',
        toolCalls: [],
        finishReason: 'complete',
      }),
  };
  return {
    provider,
    modelId:
      privacyBoundary === 'on-device' ? 'system-default' : 'gpt-synthetic',
    displayName:
      privacyBoundary === 'on-device' ? 'Apple Intelligence' : 'ChatGPT',
    privacyBoundary,
    availability,
  };
}

function makeStore(
  load: ProviderSelectionStore['load'] = async () => null,
): ProviderSelectionStore {
  return {
    load,
    save: jest.fn(async () => undefined),
    clear: jest.fn(async () => undefined),
  };
}

describe('ProviderSelectionScreen', () => {
  it('rechecks availability when a selected candidate changes before confirmation', async () => {
    const chatGPT = makeOption(
      'chatgpt-plan:synthetic-account:gpt-synthetic',
      'selected-context-remote',
    );
    const store = makeStore();
    const onSelectionCommitted = jest.fn();
    const { rerender } = await render(
      <ProviderSelectionScreen
        options={[chatGPT]}
        requirements={requirements}
        selectionStore={store}
        onSelectionCommitted={onSelectionCommitted}
      />,
    );
    await fireEvent.press(screen.getByTestId('provider-option-0'));
    const unavailableChatGPT = makeOption(
      chatGPT.provider.id,
      'selected-context-remote',
      { status: 'unavailable', message: 'ChatGPT 계정을 확인할 수 없어요.' },
    );
    await rerender(
      <ProviderSelectionScreen
        options={[unavailableChatGPT]}
        requirements={requirements}
        selectionStore={store}
        onSelectionCommitted={onSelectionCommitted}
      />,
    );

    expect(
      screen.getAllByText('ChatGPT 계정을 확인할 수 없어요.'),
    ).toHaveLength(2);
    await fireEvent.press(screen.getByTestId('provider-selection-confirm'));
    expect(
      screen.getByTestId('provider-selection-confirm').props.accessibilityState
        ?.disabled,
    ).toBe(true);
    expect(store.save).not.toHaveBeenCalled();
    expect(onSelectionCommitted).not.toHaveBeenCalled();
  });

  it('requires an explicit confirmation before persisting or routing a remote provider', async () => {
    const apple = makeOption('apple-foundation-models', 'on-device');
    const chatGPT = makeOption(
      'chatgpt-plan:synthetic-account:gpt-synthetic',
      'selected-context-remote',
    );
    const store = makeStore();
    const onSelectionCommitted = jest.fn();
    await render(
      <ProviderSelectionScreen
        options={[apple, chatGPT]}
        requirements={requirements}
        selectionStore={store}
        onSelectionCommitted={onSelectionCommitted}
      />,
    );

    expect(screen.getByText(providerSelectionText.selectPrompt)).toBeTruthy();
    expect(screen.getByText(providerSelectionText.remotePrivacy)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('provider-option-1'));

    expect(store.save).not.toHaveBeenCalled();
    expect(onSelectionCommitted).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('provider-selection-confirm'));

    await waitFor(() =>
      expect(store.save).toHaveBeenCalledWith({
        providerId: chatGPT.provider.id,
        modelId: 'gpt-synthetic',
      }),
    );
    expect(onSelectionCommitted).toHaveBeenCalledWith(
      { providerId: chatGPT.provider.id, modelId: 'gpt-synthetic' },
      chatGPT.provider,
    );
  });

  it('keeps an unavailable saved selection blocked without selecting Apple instead', async () => {
    const apple = makeOption('apple-foundation-models', 'on-device');
    const chatGPT = makeOption(
      'chatgpt-plan:synthetic-account:gpt-synthetic',
      'selected-context-remote',
      { status: 'unavailable', message: 'ChatGPT 계정을 확인할 수 없어요.' },
    );
    const store = makeStore(async () => ({
      providerId: chatGPT.provider.id,
      modelId: chatGPT.modelId,
    }));
    const onSelectionCommitted = jest.fn();
    await render(
      <ProviderSelectionScreen
        options={[apple, chatGPT]}
        requirements={requirements}
        selectionStore={store}
        onSelectionCommitted={onSelectionCommitted}
      />,
    );

    expect(
      screen.getByText(providerSelectionText.unavailableSelection),
    ).toBeTruthy();

    expect(screen.getByText('ChatGPT 계정을 확인할 수 없어요.')).toBeTruthy();
    expect(
      screen.getByTestId('provider-option-0').props.accessibilityState,
    ).toEqual({
      disabled: false,
      selected: false,
    });
    expect(store.save).not.toHaveBeenCalled();
    expect(onSelectionCommitted).not.toHaveBeenCalled();
  });

  it('does not notify the app when saving an explicit choice fails', async () => {
    const apple = makeOption('apple-foundation-models', 'on-device');
    const store = makeStore();
    jest
      .mocked(store.save)
      .mockRejectedValue(new Error('Keychain unavailable'));
    const onSelectionCommitted = jest.fn();
    await render(
      <ProviderSelectionScreen
        options={[apple]}
        requirements={requirements}
        selectionStore={store}
        onSelectionCommitted={onSelectionCommitted}
      />,
    );

    expect(screen.getByText(providerSelectionText.selectPrompt)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('provider-option-0'));
    await fireEvent.press(screen.getByTestId('provider-selection-confirm'));

    await waitFor(() =>
      expect(
        screen.getByText(providerSelectionText.storageSaveError),
      ).toBeTruthy(),
    );
    expect(onSelectionCommitted).not.toHaveBeenCalled();
  });
});
