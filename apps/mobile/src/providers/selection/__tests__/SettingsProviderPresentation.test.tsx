import { fireEvent, render, screen } from '@testing-library/react-native';
import { providerSuccess } from '@orot/model-runtime';
import type { LanguageModelProvider } from '@orot/model-runtime';
import ProviderSelectionScreen from '../ProviderSelectionScreen';
import { providerSelectionText } from '../text';
import type {
  ChatGPTAccountSetup,
  ProviderSelectionOption,
  ProviderSelectionStore,
} from '../types';

// These in-memory services exercise presentation without live accounts or persistence.
const requirements = { inputTypes: ['text'] as const, toolCalling: true };

function makeOption(
  id: string,
  privacyBoundary: ProviderSelectionOption['privacyBoundary'],
): ProviderSelectionOption {
  const provider: LanguageModelProvider = {
    kind: 'language-model',
    id,
    displayName: id,
    capabilities: {
      inputTypes: ['text', 'image'],
      streaming: true,
      structuredOutput: false,
      toolCalling: true,
    },
    generate: async () =>
      providerSuccess({
        text: 'Synthetic response',
        toolCalls: [],
        finishReason: 'complete',
      }),
  };
  return {
    provider,
    modelId:
      privacyBoundary === 'on-device' ? 'system-default' : 'gpt-synthetic',
    displayName:
      privacyBoundary === 'on-device' ? 'On-device model' : 'Synthetic model',
    privacyBoundary,
    availability: { status: 'available' },
  };
}

function makeStore(): ProviderSelectionStore {
  return {
    load: async () => null,
    save: jest.fn(async () => undefined),
    clear: jest.fn(async () => undefined),
  };
}

function makeAccountSetup(): ChatGPTAccountSetup {
  return {
    presentation: 'settings-provider',
    accounts: [
      {
        issuedClientID: 'synthetic-account',
        requiresSignIn: true,
        hasDirectPlanAccess: false,
      },
    ],
    selectedAccountID: 'synthetic-account',
    statusMessage: providerSelectionText.chatGPTAccountSignedOut,
    statusIsError: false,
    actionTitle: providerSelectionText.chatGPTReauthorize,
    busy: false,
    signingIn: false,
    signingOut: false,
    actionDisabled: false,
    onAccountSelected: jest.fn(),
    onAction: jest.fn(),
    onSignOut: jest.fn(),
    onCancelSignIn: jest.fn(),
  };
}

describe('Settings provider presentation', () => {
  it('uses measured provider panels and retains truthful status, capabilities, and explicit confirmation', async () => {
    const store = makeStore();
    const onSelectionCommitted = jest.fn();
    const local = makeOption('local', 'on-device');
    const remote = makeOption('remote', 'selected-context-remote');
    await render(
      <ProviderSelectionScreen
        presentation="settings-provider"
        screenTitle="Provider settings"
        screenIntroduction="Choose a provider for recommendations."
        options={[local, remote]}
        requirements={requirements}
        selectionStore={store}
        chatGPTSetup={makeAccountSetup()}
        onSelectionCommitted={onSelectionCommitted}
      />,
    );

    expect(screen.getByText('Provider settings')).toBeTruthy();
    expect(
      screen.getByText('Choose a provider for recommendations.'),
    ).toBeTruthy();
    expect(screen.getByTestId('settings-provider-panels-primary')).toBeTruthy();
    expect(
      screen.getByTestId('settings-provider-panels-secondary'),
    ).toBeTruthy();
    expect(screen.getByTestId('chatgpt-account-status')).toHaveTextContent(
      providerSelectionText.chatGPTAccountSignedOut,
    );
    expect(
      screen.getByTestId('provider-option-0-capabilities'),
    ).toHaveTextContent(
      `${providerSelectionText.capabilitiesSummary}: ${[
        providerSelectionText.capabilityInput.text,
        providerSelectionText.capabilityInput.image,
        providerSelectionText.capabilityStreaming,
        providerSelectionText.capabilityToolCalling,
      ].join(' · ')}`,
    );

    await fireEvent.press(screen.getByTestId('provider-option-1'));
    expect(store.save).not.toHaveBeenCalled();
    expect(onSelectionCommitted).not.toHaveBeenCalled();
    expect(
      screen.getByTestId('provider-option-1').props.accessibilityState.selected,
    ).toBe(true);
    expect(screen.getByText(providerSelectionText.remotePrivacy)).toBeTruthy();
  });

  it('keeps the feature selector in its existing combined layout', async () => {
    await render(
      <ProviderSelectionScreen
        options={[makeOption('local', 'on-device')]}
        requirements={requirements}
        selectionStore={makeStore()}
      />,
    );

    expect(screen.queryByTestId('settings-provider-panels-primary')).toBeNull();
    expect(screen.getByTestId('provider-option-0')).toBeTruthy();
    expect(screen.queryByTestId('provider-option-0-capabilities')).toBeNull();
  });
});
