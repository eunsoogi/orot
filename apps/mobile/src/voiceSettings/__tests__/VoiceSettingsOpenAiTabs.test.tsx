import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { providerCatalogContentInset } from '../../layout/providerSettingsPresentation';
import { VoiceSettingsPanel } from '../VoiceSettingsPanel';
import { VoiceSettingsDockFixture } from '../testSupport/VoiceSettingsDockFixture';
import { voiceSettingsStore } from '../voiceSettingsStore';
import { createLiveVoicePreferenceStore } from '../liveVoicePreferenceStore';
import {
  loadLiveResponsesSettings,
  saveLiveResponsesSettings,
} from '../liveResponsesSettings';
import type { LiveResponsesBackend } from '../liveResponsesSettingsIdentity';
import { createRealtimeSettingsPermission } from '../../voiceConversation/createRealtimeSettingsPermission';

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
jest.mock('../liveResponsesSettings', () => ({
  loadLiveResponsesSettings: jest.fn(),
  saveLiveResponsesSettings: jest.fn(),
  revokeLiveResponsesSettings: jest.fn(),
}));
jest.mock('../../voiceConversation/createRealtimeSettingsPermission', () => ({
  createRealtimeSettingsPermission: jest.fn(() => ({
    authorize: async () => true,
    current: () => true,
    stop: () => {},
  })),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

const tab = (name: 'speech' | 'tools') =>
  screen.getByTestId(`openai-voice-model-tab-${name}`);
const row = (model: LiveResponsesBackend) =>
  screen.getByTestId(`live-responses-backend-${model}`);
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

test('the OpenAI-only sub-tabs separate choice and approval, keep drafts, and reopen independent saved models', async () => {
  let saved: LiveResponsesBackend = 'gpt-6-luna';
  jest.mocked(loadLiveResponsesSettings).mockImplementation(async () => ({
    kind: 'active',
    credentialEpoch: 'a'.repeat(64),
    nativeGrant: {
      backendModel: saved,
      grantID: 'test-grant',
      generation: 'test-generation',
    },
    current: () => true,
    subscribe: () => () => {},
  }));
  jest.mocked(saveLiveResponsesSettings).mockImplementation(async input => {
    expect(input.isCurrent()).toBe(true);
    expect(input.audioCurrent()).toBe(true);
    saved = input.backendModel;
  });
  const props = voicePreferences();
  const view = await render(
    <VoiceSettingsDockFixture livePreferences={props} />,
  );
  await screen.findByTestId('live-voice-voice');
  const local = within(screen.getByTestId('voice-model-group-local'));
  expect(local.getByTestId('voice-model-apple-system-speech')).toBeTruthy();
  expect(local.queryByTestId('openai-voice-model-tabs')).toBeNull();
  expect(
    StyleSheet.flatten(
      screen.getByTestId('openai-voice-model-tabs').parent?.props.style,
    ),
  ).toMatchObject({
    paddingHorizontal: providerCatalogContentInset,
  });
  expect(tab('speech')).toHaveTextContent('음성 모델');
  expect(tab('tools')).toHaveTextContent('도구 호출 모델');
  expect(screen.queryByTestId('live-responses-setting')).toBeNull();
  expect(voiceSettingsStore.discoverModels).not.toHaveBeenCalled();
  const language = () => screen.getByRole('button', { name: '목소리 언어' });
  await fireEvent.press(language());
  await fireEvent.press(screen.getByRole('radio', { name: '영어' }));
  expect(language()).toHaveProp('accessibilityValue', { text: '영어' });

  await fireEvent.press(screen.getByTestId('voice-model-refresh'));
  await screen.findByTestId('voice-model-gpt-live-1.1');
  await fireEvent.press(tab('tools'));
  expect(tab('tools').props.accessibilityState).toMatchObject({
    selected: true,
  });
  expect(screen.queryByTestId('live-voice-voice')).toBeNull();
  expect(screen.queryByTestId('live-voice-language')).toBeNull();
  expect(screen.queryByTestId('voice-settings-save')).toBeNull();
  expect(screen.queryByTestId('live-responses-enable')).toBeNull();
  expect(screen.getAllByText('도구 호출 모델')).toHaveLength(1);
  expect(screen.queryByText(/gpt-6-luna를 권장/)).toBeNull();
  expect(screen.getByTestId('voice-settings-shared-dock-save')).toBeDisabled();
  expect(row('gpt-6-luna').props.accessibilityState).toMatchObject({
    selected: true,
    disabled: false,
  });
  expect(row('gpt-6-sol')).toBeEnabled();
  expect(screen.getAllByTestId(/^live-responses-backend-/)).toHaveLength(2);
  expect(screen.queryByText('gpt-unrelated')).toBeNull();
  expect(screen.getByTestId('live-responses-active-model')).toHaveTextContent(
    /OpenAI API - GPT-6 Luna/,
  );
  await fireEvent.press(row('gpt-6-sol'));
  expect(row('gpt-6-sol').props.accessibilityState).toMatchObject({
    selected: true,
  });
  await fireEvent.press(tab('speech'));
  expect(screen.getByTestId('live-voice-voice')).toBeTruthy();
  expect(language()).toHaveProp('accessibilityValue', { text: '영어' });
  await fireEvent.press(tab('tools'));
  expect(row('gpt-6-sol').props.accessibilityState).toMatchObject({
    selected: true,
  });
  expect(screen.getByTestId('live-responses-active-model')).toHaveTextContent(
    /GPT-6 Luna/,
  );
  expect(voiceSettingsStore.discoverModels).toHaveBeenCalledTimes(1);
  expect(saveLiveResponsesSettings).not.toHaveBeenCalled();
  expect(createRealtimeSettingsPermission).not.toHaveBeenCalled();
  expect(screen.queryByTestId('inference-disclosure-recipient')).toBeNull();

  const apply = () =>
    fireEvent.press(screen.getByTestId('voice-settings-shared-dock-save'));
  await apply();
  expect(
    await screen.findByTestId('inference-disclosure-recipient'),
  ).toHaveTextContent(/OpenAI Responses \(Live\)/);
  expect(screen.getByText(/별도로 API 사용료/)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('inference-disclosure-cancel'));
  expect(saveLiveResponsesSettings).not.toHaveBeenCalled();
  await waitFor(() => expect(tab('tools')).toBeEnabled());
  await apply();
  await fireEvent.press(
    await screen.findByTestId('inference-disclosure-allow'),
  );
  await waitFor(() =>
    expect(screen.getByTestId('live-responses-active-model')).toHaveTextContent(
      /GPT-6 Sol/,
    ),
  );
  expect(saveLiveResponsesSettings).toHaveBeenCalledTimes(1);
  expect(voiceSettingsStore.save).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  await view.unmount();

  await render(<VoiceSettingsDockFixture livePreferences={props} />);
  expect(await screen.findByTestId('voice-current-model')).toHaveTextContent(
    /GPT-Live-1\.1/,
  );
  await fireEvent.press(tab('tools'));
  expect(
    await screen.findByTestId('live-responses-active-model'),
  ).toHaveTextContent(/GPT-6 Sol/);
  expect(voiceSettingsStore.discoverModels).toHaveBeenCalledTimes(1);
});

test('a saved Apple speech selection cannot acquire or display an OpenAI tool choice', async () => {
  jest.mocked(voiceSettingsStore.load).mockResolvedValue({
    mode: 'local',
    model: 'apple-system-speech',
    hasApiKey: true,
  });
  jest.mocked(voiceSettingsStore.discoverModels).mockResolvedValue({
    revision: 1,
    ids: ['gpt-6-luna', 'gpt-6-sol', 'gpt-unrelated'],
  });
  await render(<VoiceSettingsPanel />);
  expect(await screen.findByTestId('voice-current-model')).toHaveTextContent(
    /Apple - Apple 시스템 음성/,
  );
  expect(voiceSettingsStore.discoverModels).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('voice-model-refresh'));
  expect(await screen.findByText(/GPT-Live-1.1을 찾지 못했어요/)).toBeTruthy();
  await fireEvent.press(tab('tools'));
  expect(screen.queryByTestId('live-responses-setting')).toBeNull();
  expect(screen.queryByTestId('live-responses-backend-gpt-6-luna')).toBeNull();
  expect(screen.getByText(/먼저 OpenAI API 음성 모델을 적용/)).toBeTruthy();
  expect(loadLiveResponsesSettings).not.toHaveBeenCalled();
  expect(voiceSettingsStore.discoverModels).toHaveBeenCalledTimes(1);
  expect(voiceSettingsStore.save).not.toHaveBeenCalled();
  expect(createRealtimeSettingsPermission).not.toHaveBeenCalled();
});
