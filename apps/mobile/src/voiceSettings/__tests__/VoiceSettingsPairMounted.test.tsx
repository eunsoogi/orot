import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { VoiceSettingsPanel } from '../VoiceSettingsPanel';
import { loadLiveResponsesSettings } from '../liveResponsesSettings';
import { createLiveVoicePreferenceStore } from '../liveVoicePreferenceStore';
import { voiceSettingsStore } from '../voiceSettingsStore';
import { saveReviewedOpenAiVoicePair } from '../saveReviewedOpenAiVoicePair';

jest.mock('../liveResponsesSettings', () => ({
  loadLiveResponsesSettings: jest.fn(async () => ({ kind: 'off' })),
}));
jest.mock('../saveReviewedOpenAiVoicePair', () => ({
  saveReviewedOpenAiVoicePair: jest.fn(),
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
    discoverModels: jest.fn(),
    subscribe: jest.fn(() => () => {}),
    accountRevisionMatches: jest.fn(() => true),
  },
}));

test('whole paired form opens only after explicit refresh; one chosen model cannot save', async () => {
  jest.mocked(voiceSettingsStore.load).mockResolvedValue({
    mode: 'local',
    model: 'apple-system-speech',
    hasApiKey: true,
  });
  jest
    .mocked(voiceSettingsStore.accountStatus)
    .mockResolvedValue({ connected: true, revision: 4 });
  jest.mocked(voiceSettingsStore.discoverModels).mockResolvedValue({
    revision: 4,
    ids: ['gpt-live-1.1', 'gpt-6-luna', 'gpt-6-sol', 'synthetic-unsupported'],
  });
  const loadPreferences = jest.fn(async () => undefined);
  const store = createLiveVoicePreferenceStore({
    currentOwner: async () => 'synthetic-owner',
    read: loadPreferences,
    write: jest.fn(),
  });
  const view = await render(
    <VoiceSettingsPanel
      livePreferences={{ ready: true, store, authorityRevision: 4 }}
    />,
  );
  await view.findByTestId('voice-model-apple-system-speech');
  expect(view.queryByTestId('voice-current-model')).toBeNull();
  expect(view.queryByTestId('openai-voice-pair-form')).toBeNull();
  expect(loadPreferences).not.toHaveBeenCalled();
  expect(voiceSettingsStore.discoverModels).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(view.getByTestId('voice-model-refresh')).not.toBeDisabled(),
  );
  await fireEvent.press(view.getByTestId('voice-model-refresh'));
  await view.findByTestId('openai-voice-pair-form');
  expect(view.getByRole('header', { name: '음성 모델' })).toBeVisible();
  await view.findByTestId('live-voice-language');
  expect(view.getByTestId('live-voice-voice')).toBeVisible();
  expect(view.getByTestId('voice-tool-model-gpt-6-luna')).toBeVisible();
  expect(view.queryByRole('tab')).toBeNull();
  await fireEvent.press(view.getByTestId('voice-tool-model-gpt-6-sol'));
  expect(view.getByTestId('voice-settings-save')).toBeDisabled();
  await fireEvent.press(view.getByTestId('voice-model-apple-system-speech'));
  await fireEvent.press(view.getByTestId('voice-model-gpt-live-1.1'));
  expect(view.getByTestId('voice-settings-save')).toBeDisabled();
  expect(saveReviewedOpenAiVoicePair).not.toHaveBeenCalled();
  await fireEvent.press(view.getByTestId('voice-tool-model-gpt-6-sol'));
  expect(view.getByTestId('voice-settings-save')).not.toBeDisabled();
  expect(view.getAllByTestId('voice-settings-save')).toHaveLength(1);
});

test('cold reopen does not present an interrupted pair as current or auto-activate it', async () => {
  jest.clearAllMocks();
  jest.mocked(voiceSettingsStore.load).mockResolvedValue({
    mode: 'openai-api',
    model: 'gpt-live-1.1',
    hasApiKey: true,
    pairAwaitingActivation: true,
  });
  jest.mocked(voiceSettingsStore.accountStatus).mockResolvedValue({
    connected: true,
    revision: 4,
  });
  jest.mocked(voiceSettingsStore.discoverModels).mockResolvedValue({
    revision: 4,
    ids: ['gpt-live-1.1', 'gpt-6-luna'],
  });
  const view = await render(<VoiceSettingsPanel />);
  expect(
    await view.findByText(/음성 모델 설정이 완료되지 않았어요/),
  ).toBeVisible();
  expect(view.queryByTestId('voice-current-model')).toBeNull();
  expect(view.queryByTestId('openai-voice-pair-form')).toBeNull();
  expect(voiceSettingsStore.discoverModels).not.toHaveBeenCalled();
  expect(saveReviewedOpenAiVoicePair).not.toHaveBeenCalled();
  expect(view.getByTestId('voice-settings-save')).toBeDisabled();
  await waitFor(() =>
    expect(view.getByTestId('voice-model-refresh')).toBeEnabled(),
  );
  await fireEvent.press(view.getByTestId('voice-model-refresh'));
  await fireEvent.press(await view.findByTestId('voice-tool-model-gpt-6-luna'));
  expect(view.getByTestId('voice-settings-save')).toBeDisabled();
  await fireEvent.press(view.getByTestId('voice-model-gpt-live-1.1'));
  expect(view.getByTestId('voice-settings-save')).toBeEnabled();
  expect(saveReviewedOpenAiVoicePair).not.toHaveBeenCalled();
});

test('cold paired settings evaluate the live receipt at mounted state publication', async () => {
  jest.clearAllMocks();
  let active = true;
  let supplied!: () => void;
  const pending = new Promise<void>(resolve => {
    supplied = resolve;
  });
  const loadVoicePairPresentation = jest.fn(async () => {
    await pending;
    return {
      settings: {
        mode: 'openai-api' as const,
        model: 'gpt-live-1.1',
        hasApiKey: true,
      },
      pairPresentationCurrent: () => active,
    };
  });
  Object.assign(voiceSettingsStore, { loadVoicePairPresentation });
  try {
    const view = await render(<VoiceSettingsPanel />);
    expect(loadVoicePairPresentation).toHaveBeenCalledTimes(1);
    supplied();
    active = false;
    expect(
      await view.findByText(/음성 모델 설정이 완료되지 않았어요/),
    ).toBeVisible();
    expect(view.queryByTestId('voice-current-model')).toBeNull();
  } finally {
    Reflect.deleteProperty(voiceSettingsStore, 'loadVoicePairPresentation');
  }
});

test.each([true, false])(
  'marks both verified saved rows on reopening without a network refresh (cached: %s)',
  async cached => {
    jest.clearAllMocks();
    const stored = jest.fn(async () =>
      cached ? ['gpt-live-1.1', 'gpt-6-sol', 'gpt-6-luna'] : [],
    );
    Object.assign(voiceSettingsStore, { loadDisplayModelCatalog: stored });
    jest.mocked(voiceSettingsStore.load).mockResolvedValue({
      mode: 'openai-api',
      model: 'gpt-live-1.1',
      hasApiKey: true,
    });
    jest.mocked(voiceSettingsStore.accountStatus).mockResolvedValue({
      connected: true,
      revision: 4,
    });
    let current = true;
    let invalidate: (() => void) | undefined;
    jest.mocked(loadLiveResponsesSettings).mockResolvedValue({
      kind: 'active',
      credentialEpoch: 'a'.repeat(64),
      nativeGrant: {
        backendModel: 'gpt-6-sol',
        grantID: 'synthetic-model',
        generation: 'synthetic',
      },
      savedPreferences: { schema: 1, language: 'ko', voice: 'noeul' },
      current: () => current,
      subscribe: notify => {
        invalidate = notify;
        return () => {
          invalidate = undefined;
        };
      },
    });
    try {
      const view = await render(<VoiceSettingsPanel />);
      await waitFor(() => {
        const speech = view.getByTestId('voice-model-gpt-live-1.1');
        const backend = view.getByTestId('voice-tool-model-gpt-6-sol');
        expect(speech).toHaveProp(
          'accessibilityState',
          expect.objectContaining({ selected: true, disabled: true }),
        );
        expect(backend).toHaveProp(
          'accessibilityState',
          expect.objectContaining({ selected: true, disabled: true }),
        );
      });
      expect(view.getAllByTestId(/^voice-model-group-/)[0]?.props.testID).toBe(
        'voice-model-group-openai-api',
      );
      expect(view.queryByTestId('voice-current-model')).toBeNull();
      const language = view.getByTestId('live-voice-language');
      expect(language).toBeDisabled();
      expect(language).toHaveProp('accessibilityValue', { text: '한국어' });
      const voice = view.getByTestId('live-voice-voice');
      expect(voice).toBeDisabled();
      expect(voice).toHaveProp('accessibilityValue', { text: '노을 · 한국어' });
      await fireEvent.press(language);
      expect(view.queryByRole('radiogroup')).toBeNull();
      expect(view.getByTestId('voice-settings-save')).toBeDisabled();
      expect(voiceSettingsStore.discoverModels).not.toHaveBeenCalled();
      expect(saveReviewedOpenAiVoicePair).not.toHaveBeenCalled();
      expect(Boolean(view.queryByTestId('voice-tool-model-gpt-6-luna'))).toBe(
        cached,
      );
      jest
        .mocked(voiceSettingsStore.discoverModels)
        .mockRejectedValueOnce(new Error('network'));
      await fireEvent.press(view.getByTestId('voice-model-refresh'));
      await waitFor(() => {
        expect(view.getByTestId('voice-model-refresh')).toBeEnabled();
        expect(view.getByTestId('live-voice-voice')).toHaveProp(
          'accessibilityValue',
          { text: '노을 · 한국어' },
        );
      });
      expect(view.getByTestId('voice-settings-save')).toBeDisabled();
      await act(async () => {
        current = false;
        invalidate?.();
      });
      expect(view.queryByTestId('live-voice-language')).toBeNull();
      expect(view.queryByTestId('live-voice-voice')).toBeNull();
      await view.unmount();
    } finally {
      Reflect.deleteProperty(voiceSettingsStore, 'loadDisplayModelCatalog');
    }
  },
);
