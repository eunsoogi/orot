import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { VoiceSettingsPanel } from '../VoiceSettingsPanel';
import { voiceSettingsStore } from '../voiceSettingsStore';
import { saveReviewedOpenAiVoicePair } from '../saveReviewedOpenAiVoicePair';
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
jest.mock('../saveReviewedOpenAiVoicePair', () => ({
  saveReviewedOpenAiVoicePair: jest.fn(),
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

const row = (model: LiveResponsesBackend) =>
  screen.getByTestId(`voice-tool-model-${model}`);
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

test('retires the previous credential catalog and its unapplied draft while the new account read is held', async () => {
  let notifyAccountChange!: () => void;
  let revision = 1;
  jest
    .mocked(voiceSettingsStore.accountRevisionMatches)
    .mockImplementation(value => value === revision);
  jest.mocked(voiceSettingsStore.subscribe).mockImplementation(listener => {
    notifyAccountChange = listener;
    return () => {};
  });
  await render(<VoiceSettingsPanel />);
  const refresh = () => screen.getByTestId('voice-model-refresh');
  await waitFor(() => expect(refresh()).toBeEnabled());
  await fireEvent.press(refresh());
  await fireEvent.press(await screen.findByTestId('voice-model-gpt-live-1.1'));
  await fireEvent.press(
    await screen.findByTestId('voice-tool-model-gpt-6-sol'),
  );
  expect(screen.getByTestId('voice-settings-save')).toBeEnabled();

  await act(async () => notifyAccountChange());
  expect(screen.getByTestId('voice-settings-save')).toBeEnabled();

  let resolveStatus!: (status: {
    connected: boolean;
    revision: number;
  }) => void;
  jest.mocked(voiceSettingsStore.accountStatus).mockReturnValueOnce(
    new Promise(resolve => {
      resolveStatus = resolve;
    }),
  );
  await act(async () => {
    revision = 2;
    notifyAccountChange();
  });
  expect(screen.queryByTestId('openai-voice-pair-form')).toBeNull();
  expect(screen.getByTestId('voice-settings-save')).toBeDisabled();
  expect(screen.queryByTestId('voice-model-gpt-live-1.1')).toBeNull();
  expect(voiceSettingsStore.discoverModels).toHaveBeenCalledTimes(1);
  expect(saveReviewedOpenAiVoicePair).not.toHaveBeenCalled();
  expect(createRealtimeSettingsPermission).not.toHaveBeenCalled();

  jest.mocked(voiceSettingsStore.discoverModels).mockResolvedValue({
    revision: 2,
    ids: ['gpt-live-1.1', 'gpt-6-sol'],
  });
  await act(async () => resolveStatus({ connected: true, revision: 2 }));
  expect(await screen.findByTestId('voice-settings-save')).toBeDisabled();
  await fireEvent.press(refresh());
  await screen.findByTestId('voice-model-gpt-live-1.1');
  expect(row('gpt-6-sol')).toBeEnabled();
  expect(row('gpt-6-sol')).toHaveProp(
    'accessibilityState',
    expect.objectContaining({ selected: false }),
  );
  expect(screen.queryByTestId('voice-tool-model-gpt-6-luna')).toBeNull();
  expect(screen.getByTestId('voice-settings-save')).toBeDisabled();
  expect(voiceSettingsStore.discoverModels).toHaveBeenCalledTimes(2);
});

test('lists only freshly discovered supported tool choices and explains empty and stale catalogs', async () => {
  jest.mocked(voiceSettingsStore.discoverModels).mockResolvedValueOnce({
    revision: 1,
    ids: ['gpt-live-1.1', 'gpt-unrelated'],
  });
  await render(<VoiceSettingsPanel />);
  const refresh = () => screen.getByTestId('voice-model-refresh');
  await waitFor(() => expect(refresh()).toBeEnabled());
  await fireEvent.press(refresh());
  expect(
    await screen.findByText(/사용할 수 있는 도구 호출 모델이 없어요/),
  ).toBeTruthy();
  expect(screen.queryAllByTestId(/^voice-tool-model-/)).toHaveLength(0);
  expect(screen.getByTestId('voice-settings-save')).toBeDisabled();
  jest.mocked(voiceSettingsStore.discoverModels).mockResolvedValueOnce({
    revision: 1,
    ids: ['gpt-live-1.1', 'gpt-6-sol', 'gpt-unrelated'],
  });
  await fireEvent.press(refresh());
  await fireEvent.press(
    await screen.findByTestId('voice-tool-model-gpt-6-sol'),
  );
  expect(screen.queryAllByTestId(/^voice-tool-model-/)).toHaveLength(1);
  expect(screen.getByTestId('voice-settings-save')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('voice-model-gpt-live-1.1'));
  expect(screen.getByTestId('voice-settings-save')).toBeEnabled();

  let fail!: (reason: Error) => void;
  jest.mocked(voiceSettingsStore.discoverModels).mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      fail = reject;
    }),
  );
  await fireEvent.press(refresh());
  expect(screen.queryAllByTestId(/^voice-tool-model-/)).toHaveLength(1);
  expect(row('gpt-6-sol')).toBeDisabled();
  expect(screen.getByTestId('voice-settings-save')).toBeDisabled();
  await act(async () => fail(new Error('network')));
  expect(screen.queryAllByTestId(/^voice-tool-model-/)).toHaveLength(1);
  expect(row('gpt-6-sol')).toBeDisabled();
  expect(screen.getByTestId('voice-settings-save')).toBeDisabled();
  expect(voiceSettingsStore.discoverModels).toHaveBeenCalledTimes(3);
  expect(saveReviewedOpenAiVoicePair).not.toHaveBeenCalled();
});
