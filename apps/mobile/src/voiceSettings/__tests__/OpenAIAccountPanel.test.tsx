import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { OpenAIAccountPanel } from '../OpenAIAccountPanel';
import { voiceSettingsStore } from '../voiceSettingsStore';
jest.mock('../voiceSettingsStore', () => ({
  voiceSettingsStore: { accountStatus: jest.fn(), setAccountKey: jest.fn() },
}));
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(voiceSettingsStore.accountStatus)
    .mockResolvedValue({ connected: true, revision: 1 });
  jest.mocked(voiceSettingsStore.setAccountKey).mockResolvedValue();
});
it('manages keys only in accounts, clears entered secrets after save and does not reveal stored values', async () => {
  const view = await render(<OpenAIAccountPanel />);
  await waitFor(() =>
    expect(view.getByTestId('openai-api-key').props.editable).toBe(true),
  );
  expect(view.getByTestId('openai-api-key').props.value).toBe('');
  expect(view.getByTestId('openai-api-key').props.secureTextEntry).toBe(true);
  await fireEvent.changeText(
    view.getByTestId('openai-api-key'),
    'synthetic-test',
  );
  await fireEvent.press(view.getByTestId('openai-api-key-save'));
  await waitFor(() =>
    expect(voiceSettingsStore.setAccountKey).toHaveBeenCalledWith(
      'synthetic-test',
    ),
  );
  await waitFor(() =>
    expect(view.getByTestId('openai-api-key').props.value).toBe(''),
  );
  await fireEvent.press(view.getByTestId('openai-api-key-remove'));
  await waitFor(() =>
    expect(voiceSettingsStore.setAccountKey).toHaveBeenLastCalledWith(''),
  );
  expect(view.getByText(/로컬 모델로 자동 전환하지 않습니다/)).toBeTruthy();
});
it('retains the old connection and redacts storage errors on failure', async () => {
  jest
    .mocked(voiceSettingsStore.setAccountKey)
    .mockRejectedValue(new Error('private payload'));
  const view = await render(<OpenAIAccountPanel />);
  await waitFor(() =>
    expect(view.getByTestId('openai-api-key').props.editable).toBe(true),
  );
  await fireEvent.press(view.getByTestId('openai-api-key-remove'));
  await waitFor(() =>
    expect(view.getByText(/기존 연결은 유지됩니다/)).toBeTruthy(),
  );
  expect(view.queryByText(/private payload/)).toBeNull();
  expect(view.getByTestId('openai-api-key-remove')).toBeTruthy();
});

it('keeps the visible label and masked input in the empty connection state', async () => {
  jest
    .mocked(voiceSettingsStore.accountStatus)
    .mockResolvedValue({ connected: false, revision: 0 });
  const view = await render(<OpenAIAccountPanel />);
  await waitFor(() =>
    expect(view.getByTestId('openai-api-key').props.editable).toBe(true),
  );
  expect(view.getByText('OpenAI API 키')).toBeTruthy();
  expect(view.getByText('API 키 연결 안 됨')).toBeTruthy();
  expect(view.getByTestId('openai-api-key-save')).toBeDisabled();
  expect(view.queryByTestId('openai-api-key-remove')).toBeNull();
  expect(view.getByTestId('openai-api-key').props).toMatchObject({
    secureTextEntry: true,
    autoCorrect: false,
    autoComplete: 'off',
    textContentType: 'none',
    maxLength: 4096,
  });
  expect(view.getByText(/저장만으로 API 요청/)).toBeTruthy();
  expect(view.getByText(/ChatGPT 구독과 별도/)).toBeTruthy();
});

it('keeps edits and repeated actions locked while a synthetic save is pending', async () => {
  let finish!: () => void;
  jest.mocked(voiceSettingsStore.setAccountKey).mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        finish = resolve;
      }),
  );
  const view = await render(<OpenAIAccountPanel />);
  await waitFor(() =>
    expect(view.getByTestId('openai-api-key').props.editable).toBe(true),
  );
  await fireEvent.changeText(
    view.getByTestId('openai-api-key'),
    'synthetic-only',
  );
  await fireEvent.press(view.getByTestId('openai-api-key-save'));
  expect(view.getByTestId('openai-api-key').props.editable).toBe(false);
  expect(view.getByTestId('openai-api-key-save')).toBeDisabled();
  expect(view.getByTestId('openai-api-key-remove')).toBeDisabled();
  await fireEvent.press(view.getByTestId('openai-api-key-save'));
  expect(voiceSettingsStore.setAccountKey).toHaveBeenCalledTimes(1);
  finish();
  await waitFor(() =>
    expect(view.getByTestId('openai-api-key').props.value).toBe(''),
  );
});

it('does not enable writes or expose a storage failure when account status cannot be read', async () => {
  jest
    .mocked(voiceSettingsStore.accountStatus)
    .mockRejectedValue(new Error('synthetic-private-error'));
  const view = await render(<OpenAIAccountPanel />);
  await waitFor(() => expect(view.getByRole('alert')).toBeTruthy());
  expect(view.queryByText(/synthetic-private-error/)).toBeNull();
  expect(view.getByTestId('openai-api-key').props.editable).toBe(false);
  expect(view.getByTestId('openai-api-key-save')).toBeDisabled();
  expect(voiceSettingsStore.setAccountKey).not.toHaveBeenCalled();
});
