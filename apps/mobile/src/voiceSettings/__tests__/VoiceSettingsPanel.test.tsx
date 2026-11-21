import * as voiceConsentView from '../testSupport/voiceSettingsAlerts';
import { waitForRefreshEnabled } from '../testSupport/voiceSettingsViewFixture';
import { hasLiveVoiceRuntime } from '../voiceRuntimeCapability';
import {
  act,
  fireEvent,
  render,
  waitFor,
  within,
} from '@testing-library/react-native';
import { VoiceSettingsPanel } from '../VoiceSettingsPanel';
import { voiceSettingsStore } from '../voiceSettingsStore';
// Native account/grant coordination has SQLite service tests; retain this view's original persistence assertions.
jest.mock('../../agent/execution/saveModelSettingsConsent', () => ({
  saveModelSettingsConsent: async (input: {
    store: { save(value: unknown): Promise<void> };
    selection: unknown;
  }) => input.store.save(input.selection),
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
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../voiceRuntimeCapability', () => ({
  hasLiveVoiceRuntime: jest.fn(() => false),
}));
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(hasLiveVoiceRuntime).mockReturnValue(true);
  jest.mocked(voiceSettingsStore.load).mockResolvedValue({
    mode: 'local',
    model: 'apple-system-speech',
    hasApiKey: true,
  });
  jest
    .mocked(voiceSettingsStore.accountStatus)
    .mockResolvedValue({ connected: true, revision: 1 });
  jest.mocked(voiceSettingsStore.discoverModels).mockResolvedValue({
    revision: 1,
    ids: ['gpt-live-1.1', 'gpt-text'],
  });
  jest.mocked(voiceSettingsStore.save).mockResolvedValue();
});
it('does not present a static catalog or credentials and refreshes only explicitly', async () => {
  const accounts = jest.fn();
  const view = await render(<VoiceSettingsPanel onOpenAccounts={accounts} />);
  await waitForRefreshEnabled(view);
  expect(view.queryByTestId('voice-api-key')).toBeNull();
  expect(view.queryByTestId('voice-model-gpt-live-1.1')).toBeNull();
  expect(voiceSettingsStore.discoverModels).not.toHaveBeenCalled();
  expect(view.queryByTestId('voice-open-accounts')).toBeNull();
  await fireEvent.press(view.getByTestId('voice-account-details'));
  await fireEvent.press(view.getByTestId('voice-open-accounts'));
  expect(accounts).toHaveBeenCalledTimes(1);
  await fireEvent.press(view.getByTestId('voice-model-refresh'));
  await waitFor(() =>
    expect(view.getByTestId('voice-model-gpt-live-1.1')).toBeTruthy(),
  );
  const local = within(view.getByTestId('voice-model-group-local'));
  const api = within(view.getByTestId('voice-model-group-openai-api'));
  expect(local.getByTestId('voice-model-apple-system-speech')).toBeTruthy();
  expect(local.getByText('기기 안에서 처리')).toBeTruthy();
  expect(local.queryByTestId('voice-model-gpt-live-1.1')).toBeNull();
  expect(api.getByTestId('voice-model-gpt-live-1.1')).toBeTruthy();
  expect(api.queryByTestId('voice-model-apple-system-speech')).toBeNull();
  expect(view.queryByTestId('voice-model-gpt-text')).toBeNull();
  expect(view.queryByTestId('voice-model-gpt-realtime-2.1')).toBeNull();
  await fireEvent.press(view.getByTestId('voice-model-gpt-live-1.1'));
  expect(view.queryByText(/자동 전환하지 않아요/)).toBeNull();
  await fireEvent.press(view.getByTestId('voice-settings-save'));
  await voiceConsentView.tapVoiceSettingsAlertButton('동의');
  await waitFor(() =>
    expect(voiceSettingsStore.save).toHaveBeenCalledWith({
      mode: 'openai-api',
      model: 'gpt-live-1.1',
      expectedAccountRevision: 1,
    }),
  );
});
it('marks retained results stale and disables API selection after a failed refresh', async () => {
  const view = await render(<VoiceSettingsPanel />);
  await waitForRefreshEnabled(view);
  await fireEvent.press(view.getByTestId('voice-model-refresh'));
  await waitFor(() =>
    expect(view.getByTestId('voice-model-gpt-live-1.1')).toBeTruthy(),
  );
  jest
    .mocked(voiceSettingsStore.discoverModels)
    .mockRejectedValue(new Error('access'));
  await fireEvent.press(view.getByTestId('voice-model-refresh'));
  await waitFor(() =>
    expect(view.getByText(/API 인증 또는 모델 접근/)).toBeTruthy(),
  );
  expect(view.getByText(/이전 조회 목록/)).toBeTruthy();
  expect(
    view.getByTestId('voice-model-gpt-live-1.1').props.accessibilityState
      .disabled,
  ).toBe(true);
});
it('preserves unavailable saved selection and never silently substitutes local', async () => {
  jest.mocked(voiceSettingsStore.load).mockResolvedValue({
    mode: 'openai-api',
    model: 'gpt-realtime-2.1',
    hasApiKey: false,
  });
  jest
    .mocked(voiceSettingsStore.accountStatus)
    .mockResolvedValue({ connected: false, revision: 1 });
  const view = await render(<VoiceSettingsPanel />);
  expect(await view.findByTestId('voice-current-model')).toHaveTextContent(
    /기존 OpenAI 음성 설정 \(전환 필요\)/,
  );
  expect(
    view.getByTestId('voice-settings-save').props.accessibilityState.disabled,
  ).toBe(true);
  expect(
    view.getByTestId('voice-model-apple-system-speech').props.accessibilityState
      .selected,
  ).toBe(false);
  expect(view.queryByText(/저장된 모델 gpt-realtime-2.1/)).toBeNull();
  expect(voiceSettingsStore.save).not.toHaveBeenCalled();
});
it('keeps inaccessible settings from being overwritten', async () => {
  jest.mocked(voiceSettingsStore.load).mockRejectedValue(new Error('locked'));
  const view = await render(<VoiceSettingsPanel />);
  await waitFor(() =>
    expect(view.getByText(/음성 설정을 읽지 못했습니다/)).toBeTruthy(),
  );
  expect(
    view.getByTestId('voice-settings-save').props.accessibilityState.disabled,
  ).toBe(true);
});
it('shows an empty discovered catalog honestly without static fallback', async () => {
  jest
    .mocked(voiceSettingsStore.discoverModels)
    .mockResolvedValue({ revision: 1, ids: [] });
  const view = await render(<VoiceSettingsPanel />);
  await waitForRefreshEnabled(view);
  await fireEvent.press(view.getByTestId('voice-model-refresh'));
  await waitFor(() =>
    expect(view.getByText(/GPT-Live-1.1을 찾지 못했어요/)).toBeTruthy(),
  );
  expect(view.queryByTestId('voice-model-gpt-realtime-2.1')).toBeNull();
  expect(
    view.queryByTestId('model-settings-transmission-disclosure'),
  ).toBeNull();
  expect(JSON.stringify(view.toJSON())).not.toContain('·');
});
it('ignores a late catalog response after disconnection', async () => {
  let changed!: () => void;
  jest.mocked(voiceSettingsStore.subscribe).mockImplementation(listener => {
    changed = listener;
    return () => {};
  });
  let resolve!: (value: { revision: number; ids: string[] }) => void;
  jest.mocked(voiceSettingsStore.discoverModels).mockReturnValue(
    new Promise(r => {
      resolve = r;
    }),
  );
  const view = await render(<VoiceSettingsPanel />);
  await waitForRefreshEnabled(view);
  await fireEvent.press(view.getByTestId('voice-model-refresh'));
  jest
    .mocked(voiceSettingsStore.accountStatus)
    .mockResolvedValue({ revision: 2, connected: false });
  await act(async () => {
    changed();
  });
  await act(async () => {
    resolve({ revision: 1, ids: ['gpt-realtime-2.1'] });
  });
  expect(view.queryByTestId('voice-model-gpt-realtime-2.1')).toBeNull();
  expect(
    view.getByTestId('voice-model-refresh').props.accessibilityState.disabled,
  ).toBe(true);
});
it('keeps settings quiet without starting a call or granting runtime consent', async () => {
  jest.mocked(hasLiveVoiceRuntime).mockReturnValue(true);
  const view = await render(<VoiceSettingsPanel />);
  await waitForRefreshEnabled(view);
  await fireEvent.press(view.getByTestId('voice-model-refresh'));
  await waitFor(() =>
    expect(view.getByTestId('voice-model-gpt-live-1.1')).toBeTruthy(),
  );
  await fireEvent.press(view.getByTestId('voice-model-gpt-live-1.1'));
  voiceConsentView.expectNoInlineVoiceConsent(view);
  expect(voiceSettingsStore.save).not.toHaveBeenCalled();
  await fireEvent.press(view.getByTestId('voice-settings-save'));
  expect(voiceSettingsStore.save).not.toHaveBeenCalled();
  await voiceConsentView.expectLiveSettingsDisclosure(view);
  await voiceConsentView.tapVoiceSettingsAlertButton('취소');
  expect(voiceSettingsStore.save).not.toHaveBeenCalled();
});
it('reports failed persistence without claiming the selected model was saved', async () => {
  jest.mocked(voiceSettingsStore.save).mockRejectedValue(new Error('locked'));
  const view = await render(<VoiceSettingsPanel />);
  await waitFor(() =>
    expect(
      view.getByTestId('voice-settings-save').props.accessibilityState.disabled,
    ).toBe(false),
  );
  await fireEvent.press(view.getByTestId('voice-settings-save'));
  await waitFor(() =>
    expect(view.getByText(/저장하지 못했습니다/)).toBeTruthy(),
  );
  expect(view.queryByText(/음성 설정을 저장했습니다/)).toBeNull();
});
it('shows the stored model before refresh and keeps it distinct from an unsaved choice', async () => {
  const view = await render(<VoiceSettingsPanel />);
  await waitFor(() =>
    expect(view.getByTestId('voice-current-model')).toHaveTextContent(
      /Apple 시스템 음성/,
    ),
  );
  expect(voiceSettingsStore.discoverModels).not.toHaveBeenCalled();
  expect(
    view.getByTestId('voice-model-refresh').props.accessibilityState,
  ).toMatchObject({
    disabled: false,
    busy: false,
  });
  await fireEvent.press(view.getByTestId('voice-model-refresh'));
  await waitFor(() =>
    expect(view.getByTestId('voice-model-gpt-live-1.1')).toBeTruthy(),
  );
  await fireEvent.press(view.getByTestId('voice-model-gpt-live-1.1'));
  expect(view.getByTestId('voice-current-model')).toHaveTextContent(
    /Apple 시스템 음성/,
  );
  await fireEvent.press(view.getByTestId('voice-settings-save'));
  await voiceConsentView.tapVoiceSettingsAlertButton('동의');
  await waitFor(() =>
    expect(view.getByTestId('voice-current-model')).toHaveTextContent(
      /GPT-Live-1.1/,
    ),
  );
});
