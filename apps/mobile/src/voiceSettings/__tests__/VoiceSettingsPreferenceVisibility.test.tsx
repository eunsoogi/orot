import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { providerCatalogContentInset } from '../../layout/providerSettingsPresentation';
import { createLiveVoicePreferenceStore } from '../liveVoicePreferenceStore';
import { VoiceSettingsPanel } from '../VoiceSettingsPanel';
import { voiceSettingsStore } from '../voiceSettingsStore';

jest.mock('../voiceRuntimeCapability', () => ({
  hasLiveVoiceRuntime: () => true,
}));
jest.mock('../voiceSettingsStore', () => ({
  voiceSettingsStore: {
    load: jest.fn(),
    save: jest.fn(),
    accountStatus: jest.fn(),
    discoverModels: jest.fn(),
    subscribe: jest.fn(() => () => {}),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(voiceSettingsStore.accountStatus)
    .mockResolvedValue({ connected: true, revision: 1 });
  jest.mocked(voiceSettingsStore.discoverModels).mockResolvedValue({
    revision: 1,
    ids: ['gpt-live-1.1'],
  });
});

function preferences() {
  const read = jest.fn(async () => ({
    owner: 'test-owner',
    preferences: { schema: 1, language: 'ko', voice: 'noeul' },
  }));
  const write = jest.fn(async () => {});
  const store = createLiveVoicePreferenceStore({
    currentOwner: async () => 'test-owner',
    read,
    write,
  });
  return { read, write, props: { ready: true, store, authorityRevision: 1 } };
}

test.each([
  ['local', 'apple-system-speech'],
  ['local', ''],
  ['openai-api', 'gpt-realtime-2.1'],
] as const)(
  'only the actively selected Live draft displays voice preferences (%s / %s)',
  async (mode, model) => {
    jest
      .mocked(voiceSettingsStore.load)
      .mockResolvedValue({ mode, model, hasApiKey: true });
    const { read, write, props } = preferences();
    const view = await render(<VoiceSettingsPanel livePreferences={props} />);
    await view.findByTestId('voice-current-model');
    expect(view.queryByTestId('live-voice-language')).toBeNull();
    expect(read).not.toHaveBeenCalled();
    await fireEvent.press(view.getByTestId('voice-model-refresh'));
    const live = await view.findByTestId('voice-model-gpt-live-1.1');
    expect(view.queryByTestId('live-voice-language')).toBeNull();
    await fireEvent.press(live);
    await view.findByTestId('live-voice-language');
    expect(view.getByTestId('live-voice-voice')).toBeTruthy();
    await fireEvent.press(view.getByTestId('voice-model-apple-system-speech'));
    expect(view.queryByTestId('live-voice-language')).toBeNull();
    expect(view.queryByTestId('live-voice-voice')).toBeNull();
    expect(write).not.toHaveBeenCalled();
    expect(voiceSettingsStore.save).not.toHaveBeenCalled();
    expect(view.getAllByTestId('voice-settings-save')).toHaveLength(1);
  },
);

test('saved Live shows the saved catalog preference, with the adjacent option content inset', async () => {
  jest.mocked(voiceSettingsStore.load).mockResolvedValue({
    mode: 'openai-api',
    model: 'gpt-live-1.1',
    hasApiKey: true,
  });
  const { props } = preferences();
  const view = await render(<VoiceSettingsPanel livePreferences={props} />);
  const group = await view.findByTestId('live-voice-preferences');
  const language = view.getByTestId('live-voice-language');
  const button = view.getByRole('button', { name: '목소리 언어' });
  expect(language).toBeTruthy();
  expect(view.getByText('한국어')).toBeTruthy();
  expect(view.getByText('노을 · 한국어')).toBeTruthy();
  expect(
    StyleSheet.flatten(group.props.style).paddingHorizontal +
      StyleSheet.flatten(button.props.style).paddingHorizontal,
  ).toBe(providerCatalogContentInset);
  expect(StyleSheet.flatten(group.props.style).paddingBottom).toBe(8);
});
