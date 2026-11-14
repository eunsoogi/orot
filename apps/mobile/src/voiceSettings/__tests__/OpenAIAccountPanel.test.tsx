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
