import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { providerSuccess } from '@orot/model-runtime';
import type { LanguageModelProvider } from '@orot/model-runtime';
import {
  ModelSettingsServicesContext,
  type ModelSettingsServices,
} from '../../../agent/execution/ModelSettingsServices';
import ProviderSelectionScreen from '../ProviderSelectionScreen';
import { t } from '../../../i18n';
import { providerSelectionText } from '../text';
import type {
  ChatGPTAccountSetup,
  ProviderSelectionOption,
  ProviderSelectionStore,
} from '../types';
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

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
    const remote = makeOption(
      'openai-api-decisions',
      'selected-context-remote',
    );
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
      screen.queryByTestId('settings-provider-panels-secondary'),
    ).toBeNull();
    expect(screen.getByTestId('chatgpt-account-status')).toHaveTextContent(
      providerSelectionText.chatGPTAccountSignedOut,
    );
    expect(screen.queryByTestId('provider-option-0-capabilities')).toBeNull();
    expect(screen.queryByText('기기 안에서 처리')).toBeNull();
    await fireEvent.press(screen.getByTestId('provider-option-0'));
    expect(screen.queryByTestId('provider-selection-current-card')).toBeNull();
    expect(
      screen.getByTestId('provider-option-0').props.accessibilityState.selected,
    ).toBe(true);
    expect(
      screen.queryByTestId('provider-selection-confirmation-privacy'),
    ).toBeNull();
    expect(store.save).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('provider-selection-cancel'));
    expect(screen.queryByTestId('provider-option-1-capabilities')).toBeNull();
    // The catalog wrapper takes natural content height rather than filling the scroll page.
    expect(
      screen.getByTestId('provider-choices-content').props.style,
    ).toBeUndefined();

    await fireEvent.press(screen.getByTestId('provider-option-1'));
    expect(store.save).not.toHaveBeenCalled();
    expect(onSelectionCommitted).not.toHaveBeenCalled();
    expect(
      screen.getByTestId('provider-option-1').props.accessibilityState.selected,
    ).toBe(true);
    expect(screen.queryByTestId('inference-disclosure-sheet')).toBeNull();
    await fireEvent.press(screen.getByTestId('provider-selection-confirm'));
    const sheet = within(
      await screen.findByTestId('inference-disclosure-sheet'),
    );
    expect(
      sheet.getByTestId('inference-disclosure-recipient'),
    ).toHaveTextContent('OpenAI API');
    const scope = sheet.getByTestId('inference-disclosure-scope');
    expect(scope).toHaveTextContent(/대화와 보고서 생성에 필요한 질문/);
    expect(scope).toHaveTextContent(/Europe PMC[\s\S]+의학 문헌 검색어/);
    expect(sheet.getByText(t('modelSettings.consentContinuing'))).toBeTruthy();
    expect(store.save).not.toHaveBeenCalled();
    await fireEvent.press(sheet.getByTestId('inference-disclosure-cancel'));
    await waitFor(() =>
      expect(screen.queryByTestId('inference-disclosure-sheet')).toBeNull(),
    );
    expect(store.save).not.toHaveBeenCalled();
    expect(onSelectionCommitted).not.toHaveBeenCalled();
  });

  it('uses measured panels and capability summaries in the in-flow feature selector', async () => {
    await render(
      <ProviderSelectionScreen
        options={[
          makeOption('local', 'on-device'),
          makeOption('remote', 'selected-context-remote'),
        ]}
        requirements={requirements}
        selectionStore={makeStore()}
      />,
    );

    expect(screen.queryByTestId('settings-provider-panels-primary')).toBeNull();
    expect(
      screen.getByTestId('provider-selection-feature-panels-primary'),
    ).toBeTruthy();
    expect(
      screen.queryByTestId('provider-selection-feature-panels-secondary'),
    ).toBeNull();
    expect(screen.queryByTestId('provider-option-0-capabilities')).toBeNull();
  });
});

it('shows each model tab without extra summary without a redundant current-selection card', async () => {
  const local = makeOption('local', 'on-device');
  const calendar = makeStore();
  const voice: ModelSettingsServices['voice'] = {
    load: async () => ({
      mode: 'local',
      model: 'apple-system-speech',
      hasApiKey: false,
    }),
    save: jest.fn(),
    accountStatus: async () => ({ connected: false, revision: 0 }),
    accountRevisionMatches: revision => revision === 0,
    discoverModels: jest.fn(),
    subscribe: () => () => undefined,
  };
  await render(
    <ModelSettingsServicesContext.Provider
      value={{
        calendar,
        voice,
        calendarOption: jest.fn(),
        saveConsent: jest.fn(),
      }}
    >
      <ProviderSelectionScreen
        options={[local]}
        requirements={requirements}
        selectionStore={makeStore()}
        presentation="settings-provider"
      />
    </ModelSettingsServicesContext.Provider>,
  );
  const summaries = () =>
    screen.queryAllByTestId(
      /^(provider-selection-current|calendar-current-model|voice-current-model)-card$/,
    );
  expect(screen.getByTestId('settings-provider-local-panel')).toBeTruthy();
  expect(summaries()).toHaveLength(0);
  await fireEvent.press(screen.getByTestId('model-tab-calendar'));
  expect(screen.getByTestId('calendar-model-settings')).toBeTruthy();
  expect(summaries()).toHaveLength(0);
  await fireEvent.press(screen.getByTestId('model-tab-voice'));
  expect(await screen.findByTestId('voice-model-group-local')).toBeTruthy();
  expect(summaries()).toHaveLength(0);
  expect(calendar.save).not.toHaveBeenCalled();
});
