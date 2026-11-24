import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import {
  providerCatalogContentInset,
  providerSettingsStyles,
} from '../../layout/providerSettingsPresentation';
import { t } from '../../i18n';
import { VoiceSettingsPanel } from '../VoiceSettingsPanel';
import { VoiceSettingsDockFixture } from '../testSupport/VoiceSettingsDockFixture';
import { voiceSettingsStore } from '../voiceSettingsStore';
import { createLiveVoicePreferenceStore } from '../liveVoicePreferenceStore';
import { saveReviewedOpenAiVoicePair } from '../saveReviewedOpenAiVoicePair';

jest.mock('../saveReviewedOpenAiVoicePair', () => ({
  saveReviewedOpenAiVoicePair: jest.fn(async () => () => true),
}));
jest.mock('../voiceRuntimeCapability', () => ({
  hasLiveVoiceRuntime: () => true,
  hasLiveResponsesRuntime: () => true,
}));
jest.mock('../voiceSettingsStore', () => ({
  voiceSettingsStore: {
    load: jest.fn(),
    save: jest.fn(),
    accountStatus: jest.fn(),
    accountRevisionMatches: jest.fn(() => true),
    discoverModels: jest.fn(),
    subscribe: jest.fn(() => () => {}),
  },
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

const write = jest.fn(async () => {});
function voicePreferences() {
  return {
    ready: true,
    authorityRevision: 1,
    systemLanguage: 'ko' as const,
    store: createLiveVoicePreferenceStore({
      currentOwner: async () => 'synthetic-owner',
      read: async () => ({
        owner: 'synthetic-owner',
        preferences: { schema: 1, language: 'ko', voice: 'noeul' },
      }),
      write,
    }),
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(voiceSettingsStore.load).mockResolvedValue({
    mode: 'openai-api',
    model: 'gpt-live-1.1',
    hasApiKey: true,
  });
  jest.mocked(voiceSettingsStore.accountStatus).mockResolvedValue({
    connected: true,
    revision: 1,
  });
  jest.mocked(voiceSettingsStore.discoverModels).mockResolvedValue({
    revision: 1,
    ids: ['gpt-live-1.1', 'gpt-6-luna', 'gpt-6-sol', 'gpt-unrelated'],
  });
});

test('shared dock never persists half a pair across decline; a complete fresh pair commits once', async () => {
  await render(
    <VoiceSettingsDockFixture livePreferences={voicePreferences()} />,
  );
  const refresh = () => screen.getByTestId('voice-model-refresh');
  const save = () => screen.getByTestId('voice-settings-shared-dock-save');
  await waitFor(() => expect(refresh()).toBeEnabled());
  const apple = within(screen.getByTestId('voice-model-group-local'));
  expect(apple.getByTestId('voice-model-apple-system-speech')).toBeTruthy();
  expect(screen.queryByRole('tab')).toBeNull();
  expect(screen.queryByTestId('openai-voice-pair-form')).toBeNull();
  expect(voiceSettingsStore.discoverModels).not.toHaveBeenCalled();
  expect(save()).toBeDisabled();
  await fireEvent.press(refresh());
  const speech = await screen.findByTestId('voice-model-gpt-live-1.1');
  await fireEvent.press(speech);
  expect(save()).toBeDisabled();
  await fireEvent.press(screen.getByTestId('voice-tool-model-gpt-6-sol'));
  expect(save()).toBeEnabled();
  expect(screen.queryByTestId('voice-settings-save')).toBeNull();
  expect(screen.queryByTestId('live-responses-enable')).toBeNull();
  expect(screen.queryByTestId('live-responses-disable')).toBeNull();
  expect(screen.queryByText('gpt-unrelated')).toBeNull();
  expect(screen.getByTestId('live-voice-language')).toBeVisible();
  expect(screen.getByTestId('live-voice-voice')).toBeVisible();
  await fireEvent.press(save());
  expect(
    await screen.findByTestId('inference-disclosure-recipient'),
  ).toHaveTextContent(/OpenAI Live/);
  await fireEvent.press(screen.getByTestId('inference-disclosure-allow'));
  await waitFor(() =>
    expect(
      screen.getByTestId('inference-disclosure-recipient'),
    ).toHaveTextContent(/OpenAI Responses/),
  );
  expect(saveReviewedOpenAiVoicePair).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('inference-disclosure-cancel'));
  expect(voiceSettingsStore.save).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  expect(saveReviewedOpenAiVoicePair).not.toHaveBeenCalled();
  await waitFor(() => expect(save()).toBeEnabled());
  await fireEvent.press(save());
  await fireEvent.press(
    await screen.findByTestId('inference-disclosure-allow'),
  );
  await waitFor(() =>
    expect(
      screen.getByTestId('inference-disclosure-recipient'),
    ).toHaveTextContent(/OpenAI Responses/),
  );
  await fireEvent.press(screen.getByTestId('inference-disclosure-allow'));
  await waitFor(() =>
    expect(saveReviewedOpenAiVoicePair).toHaveBeenCalledTimes(1),
  );
  expect(saveReviewedOpenAiVoicePair).toHaveBeenCalledWith(
    expect.objectContaining({
      pair: {
        speechModel: 'gpt-live-1.1',
        backendModel: 'gpt-6-sol',
        accountRevision: 1,
      },
    }),
  );
  expect(voiceSettingsStore.save).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});

it('uses the same summary for distinct draft and saved states', async () => {
  jest.mocked(voiceSettingsStore.load).mockResolvedValue({
    mode: 'local',
    model: 'apple-system-speech',
    hasApiKey: true,
  });
  const view = await render(<VoiceSettingsPanel />);
  const summary = await view.findByTestId('voice-current-model');
  expect(summary).toHaveTextContent(/Apple - Apple 시스템 음성/);
  expect(voiceSettingsStore.discoverModels).not.toHaveBeenCalled();
  const refresh = view.getByTestId('voice-model-refresh');
  expect(refresh.props.accessibilityState).toMatchObject({
    disabled: false,
    busy: false,
  });
  await fireEvent.press(refresh);
  const api = await view.findByTestId('voice-model-gpt-live-1.1');
  await fireEvent.press(api);
  expect(summary).toHaveTextContent(/선택한 AI.*OpenAI API - GPT-Live-1.1/s);
  await fireEvent.press(view.getByTestId('voice-model-apple-system-speech'));
  expect(summary).toHaveTextContent(/현재 선택:.*Apple - Apple 시스템 음성/s);
  expect(voiceSettingsStore.save).not.toHaveBeenCalled();
  await fireEvent.press(api);
  await fireEvent.press(view.getByTestId('voice-tool-model-gpt-6-luna'));
  await fireEvent.press(view.getByTestId('voice-settings-save'));
  await fireEvent.press(await view.findByTestId('inference-disclosure-allow'));
  await waitFor(() =>
    expect(
      view.getByTestId('inference-disclosure-recipient'),
    ).toHaveTextContent(/OpenAI Responses/),
  );
  await fireEvent.press(view.getByTestId('inference-disclosure-allow'));
  await waitFor(() =>
    expect(summary).toHaveTextContent(
      /현재 선택:.*OpenAI API - GPT-Live-1\.1/s,
    ),
  );
});

test('an exact commit receipt that expires before Save continuation does not mark the pair active', async () => {
  jest.mocked(saveReviewedOpenAiVoicePair).mockResolvedValueOnce(() => false);
  await render(
    <VoiceSettingsDockFixture livePreferences={voicePreferences()} />,
  );
  const refresh = () => screen.getByTestId('voice-model-refresh');
  await waitFor(() => expect(refresh()).toBeEnabled());
  await fireEvent.press(refresh());
  await fireEvent.press(await screen.findByTestId('voice-model-gpt-live-1.1'));
  await fireEvent.press(screen.getByTestId('voice-tool-model-gpt-6-sol'));
  await fireEvent.press(screen.getByTestId('voice-settings-shared-dock-save'));
  await fireEvent.press(
    await screen.findByTestId('inference-disclosure-allow'),
  );
  await waitFor(() =>
    expect(
      screen.getByTestId('inference-disclosure-recipient'),
    ).toHaveTextContent(/OpenAI Responses/),
  );
  await fireEvent.press(screen.getByTestId('inference-disclosure-allow'));
  expect(
    await screen.findByText(/음성 모델 설정이 완료되지 않았어요/),
  ).toBeVisible();
  expect(screen.queryByTestId('voice-current-model')).toBeNull();
});

test('the OpenAI catalog card contains all refreshed voice controls', async () => {
  await render(
    <VoiceSettingsDockFixture livePreferences={voicePreferences()} />,
  );
  const card = screen.getByTestId('voice-openai-catalog-card');
  const inside = within(card);
  expect(StyleSheet.flatten(card.props.style)).toEqual(
    StyleSheet.flatten(providerSettingsStyles.catalogAccount),
  );
  expect(inside.getByTestId('voice-account-details')).toBeVisible();
  const refresh = inside.getByTestId('voice-model-refresh');
  expect(inside.queryByTestId('openai-voice-pair-form')).toBeNull();
  expect(inside.queryByText(t('modelSettings.modelListNotice'))).toBeNull();
  expect(voiceSettingsStore.discoverModels).not.toHaveBeenCalled();
  await waitFor(() => expect(refresh).toBeEnabled());
  await fireEvent.press(refresh);
  expect(await inside.findByTestId('voice-model-gpt-live-1.1')).toBeVisible();
  expect(await inside.findByTestId('live-voice-language')).toBeVisible();
  expect(inside.getByTestId('live-voice-voice')).toBeVisible();
  expect(inside.getByTestId('voice-tool-model-gpt-6-sol')).toBeVisible();
  const footer = inside.getByText(t('modelSettings.modelListNotice'));
  expect(footer).toBeVisible();
  expect(footer.props.accessibilityRole).toBe('status');
  expect(footer.props.numberOfLines).toBeUndefined();
  expect(StyleSheet.flatten(footer.props.style)).toMatchObject({
    paddingHorizontal: providerCatalogContentInset,
    paddingTop: 4,
    paddingBottom: providerCatalogContentInset,
  });
});
