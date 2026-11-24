import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { VoiceSettingsPanel } from '../VoiceSettingsPanel';
import { voiceSettingsStore } from '../voiceSettingsStore';
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
  jest.mocked(loadLiveResponsesSettings).mockResolvedValue({ kind: 'off' });
  await render(<VoiceSettingsPanel />);
  const refresh = () => screen.getByTestId('voice-model-refresh');
  await waitFor(() => expect(refresh()).toBeEnabled());
  await fireEvent.press(refresh());
  await screen.findByTestId('voice-model-gpt-live-1.1');
  await fireEvent.press(tab('tools'));
  await fireEvent.press(
    await screen.findByTestId('live-responses-backend-gpt-6-sol'),
  );
  expect(screen.getByTestId('live-responses-enable')).toBeEnabled();

  await act(async () => notifyAccountChange());
  expect(screen.getByTestId('live-responses-enable')).toBeEnabled();

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
  expect(screen.queryByTestId('live-responses-setting')).toBeNull();
  expect(screen.queryByTestId('live-responses-enable')).toBeNull();
  await fireEvent.press(tab('speech'));
  expect(screen.queryByTestId('voice-model-gpt-live-1.1')).toBeNull();
  await fireEvent.press(tab('tools'));
  expect(voiceSettingsStore.discoverModels).toHaveBeenCalledTimes(1);
  expect(saveLiveResponsesSettings).not.toHaveBeenCalled();
  expect(createRealtimeSettingsPermission).not.toHaveBeenCalled();

  jest.mocked(voiceSettingsStore.discoverModels).mockResolvedValue({
    revision: 2,
    ids: ['gpt-live-1.1', 'gpt-6-sol'],
  });
  await act(async () => resolveStatus({ connected: true, revision: 2 }));
  expect(await screen.findByTestId('live-responses-enable')).toBeDisabled();
  await fireEvent.press(tab('speech'));
  await fireEvent.press(refresh());
  await screen.findByTestId('voice-model-gpt-live-1.1');
  await fireEvent.press(tab('tools'));
  expect(row('gpt-6-sol')).toBeEnabled();
  expect(row('gpt-6-sol')).toHaveProp(
    'accessibilityState',
    expect.objectContaining({ selected: false }),
  );
  expect(row('gpt-6-luna')).toBeDisabled();
  expect(screen.getByTestId('live-responses-enable')).toBeDisabled();
  expect(voiceSettingsStore.discoverModels).toHaveBeenCalledTimes(2);
});
