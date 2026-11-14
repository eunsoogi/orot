import { hasRealtimeVoiceRuntime } from '../voiceRuntimeCapability';
import {
  act,
  fireEvent,
  render,
  waitFor,
  within,
} from '@testing-library/react-native';
import { VoiceSettingsPanel } from '../VoiceSettingsPanel';
import { voiceSettingsStore } from '../voiceSettingsStore';

jest.mock('../voiceSettingsStore', () => ({
  voiceSettingsStore: {
    load: jest.fn(),
    save: jest.fn(),
    accountStatus: jest.fn(),
    discoverModels: jest.fn(),
    subscribe: jest.fn(() => () => {}),
  },
}));
jest.mock('../voiceRuntimeCapability', () => ({
  hasRealtimeVoiceRuntime: jest.fn(() => false),
}));
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(hasRealtimeVoiceRuntime).mockReturnValue(false);
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
    ids: ['gpt-realtime-2.1-mini', 'gpt-text'],
  });
  jest.mocked(voiceSettingsStore.save).mockResolvedValue();
});
it('does not present a static catalog or credentials and refreshes only explicitly', async () => {
  const accounts = jest.fn();
  const view = await render(<VoiceSettingsPanel onOpenAccounts={accounts} />);
  await waitFor(() =>
    expect(
      view.getByTestId('voice-model-refresh').props.accessibilityState.disabled,
    ).toBe(false),
  );
  expect(view.queryByTestId('voice-api-key')).toBeNull();
  expect(view.queryByTestId('voice-model-gpt-realtime-2.1-mini')).toBeNull();
  expect(voiceSettingsStore.discoverModels).not.toHaveBeenCalled();
  await fireEvent.press(view.getByTestId('voice-open-accounts'));
  expect(accounts).toHaveBeenCalledTimes(1);
  await fireEvent.press(view.getByTestId('voice-model-refresh'));
  await waitFor(() =>
    expect(view.getByTestId('voice-model-gpt-realtime-2.1-mini')).toBeTruthy(),
  );
  const local = within(view.getByTestId('voice-model-group-local'));
  const api = within(view.getByTestId('voice-model-group-openai-api'));
  expect(local.getByTestId('voice-model-apple-system-speech')).toBeTruthy();
  expect(local.queryByTestId('voice-model-gpt-realtime-2.1-mini')).toBeNull();
  expect(api.getByTestId('voice-model-gpt-realtime-2.1-mini')).toBeTruthy();
  expect(api.queryByTestId('voice-model-apple-system-speech')).toBeNull();
  expect(view.queryByTestId('voice-model-gpt-text')).toBeNull();
  expect(view.queryByTestId('voice-model-gpt-realtime-2.1')).toBeNull();
  await fireEvent.press(view.getByTestId('voice-model-gpt-realtime-2.1-mini'));
  expect(view.getByText(/이 빌드에는 Realtime 통화 기능이 없어/)).toBeTruthy();
  await fireEvent.press(view.getByTestId('voice-settings-save'));
  await waitFor(() =>
    expect(voiceSettingsStore.save).toHaveBeenCalledWith({
      mode: 'openai-api',
      model: 'gpt-realtime-2.1-mini',
      expectedAccountRevision: 1,
    }),
  );
});
it('marks retained results stale and disables API selection after a failed refresh', async () => {
  const view = await render(<VoiceSettingsPanel />);
  await waitFor(() =>
    expect(
      view.getByTestId('voice-model-refresh').props.accessibilityState.disabled,
    ).toBe(false),
  );
  await fireEvent.press(view.getByTestId('voice-model-refresh'));
  await waitFor(() =>
    expect(view.getByTestId('voice-model-gpt-realtime-2.1-mini')).toBeTruthy(),
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
    view.getByTestId('voice-model-gpt-realtime-2.1-mini').props
      .accessibilityState.disabled,
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
  await waitFor(() =>
    expect(view.getByText(/저장된 모델 gpt-realtime-2.1/)).toBeTruthy(),
  );
  expect(
    view.getByTestId('voice-settings-save').props.accessibilityState.disabled,
  ).toBe(true);
  expect(
    view.getByTestId('voice-model-apple-system-speech').props.accessibilityState
      .selected,
  ).toBe(false);
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
  await waitFor(() =>
    expect(
      view.getByTestId('voice-model-refresh').props.accessibilityState.disabled,
    ).toBe(false),
  );
  await fireEvent.press(view.getByTestId('voice-model-refresh'));
  await waitFor(() =>
    expect(
      view.getByText(/지원하는 Realtime 음성 모델이 없습니다/),
    ).toBeTruthy(),
  );
  expect(view.queryByTestId('voice-model-gpt-realtime-2.1')).toBeNull();
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
  await waitFor(() =>
    expect(
      view.getByTestId('voice-model-refresh').props.accessibilityState.disabled,
    ).toBe(false),
  );
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

it('retains audio consent and billing disclosure when the runtime exists', async () => {
  jest.mocked(hasRealtimeVoiceRuntime).mockReturnValue(true);
  const view = await render(<VoiceSettingsPanel />);
  await waitFor(() =>
    expect(
      view.getByTestId('voice-model-refresh').props.accessibilityState.disabled,
    ).toBe(false),
  );
  await fireEvent.press(view.getByTestId('voice-model-refresh'));
  await waitFor(() =>
    expect(view.getByTestId('voice-model-gpt-realtime-2.1-mini')).toBeTruthy(),
  );
  await fireEvent.press(view.getByTestId('voice-model-gpt-realtime-2.1-mini'));
  expect(view.getByText(/별도로 동의해야 합니다/)).toBeTruthy();
  expect(view.getByText(/API 사용 요금/)).toBeTruthy();
  expect(voiceSettingsStore.save).not.toHaveBeenCalled();
  expect(JSON.stringify(view.toJSON())).not.toContain('·');
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
