import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { VoiceSettingsPanel } from '../VoiceSettingsPanel';
import { voiceSettingsStore } from '../voiceSettingsStore';

jest.mock('../voiceSettingsStore', () => ({
  voiceSettingsStore: {
    load: jest.fn(),
    save: jest.fn(),
  },
}));
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(voiceSettingsStore.load).mockResolvedValue({
    mode: 'local',
    model: 'apple-system-speech',
    hasApiKey: false,
  });
  jest.mocked(voiceSettingsStore.save).mockResolvedValue();
});
it('offers concrete models rather than a generic API toggle and saves only on explicit action', async () => {
  const view = await render(<VoiceSettingsPanel />);
  await waitFor(() =>
    expect(
      view.getByTestId('voice-model-apple-system-speech').props
        .accessibilityState.disabled,
    ).toBe(false),
  );
  await fireEvent.press(view.getByTestId('voice-model-gpt-realtime-2.1-mini'));
  expect(view.getByText(/현재는 설정 저장만 지원합니다/)).toBeTruthy();
  expect(voiceSettingsStore.save).not.toHaveBeenCalled();
  await fireEvent.changeText(
    view.getByTestId('voice-api-key'),
    'synthetic-secret',
  );
  await fireEvent.press(view.getByTestId('voice-settings-save'));
  await waitFor(() =>
    expect(voiceSettingsStore.save).toHaveBeenCalledWith({
      mode: 'openai-api',
      model: 'gpt-realtime-2.1-mini',
      replacementKey: 'synthetic-secret',
      removeKey: false,
    }),
  );
  await waitFor(() =>
    expect(view.getByTestId('voice-api-key').props.value).toBe(''),
  );
});
it('never renders saved credentials and explicitly returns to Apple when deleting a key', async () => {
  jest.mocked(voiceSettingsStore.load).mockResolvedValue({
    mode: 'openai-api',
    model: 'gpt-realtime-2.1',
    hasApiKey: true,
  });
  const view = await render(<VoiceSettingsPanel />);
  await waitFor(() =>
    expect(view.getByTestId('voice-api-key').props.value).toBe(''),
  );
  expect(view.getByTestId('voice-api-key').props.secureTextEntry).toBe(true);
  await fireEvent.press(view.getByTestId('voice-key-remove'));
  await waitFor(() =>
    expect(voiceSettingsStore.save).toHaveBeenCalledWith({
      mode: 'local',
      model: 'apple-system-speech',
      replacementKey: '',
      removeKey: true,
    }),
  );
  await waitFor(() =>
    expect(view.queryByTestId('voice-key-remove')).toBeNull(),
  );
});
it('keeps corrupt or inaccessible settings from being silently overwritten', async () => {
  jest.mocked(voiceSettingsStore.load).mockRejectedValue(new Error('locked'));
  const view = await render(<VoiceSettingsPanel />);
  await waitFor(() =>
    expect(view.getByText(/음성 설정을 읽지 못했습니다/)).toBeTruthy(),
  );
  await fireEvent.press(view.getByTestId('voice-settings-save'));
  expect(voiceSettingsStore.save).not.toHaveBeenCalled();
});
it('reports failed persistence without claiming that the model changed', async () => {
  jest.mocked(voiceSettingsStore.save).mockRejectedValue(new Error('locked'));
  const view = await render(<VoiceSettingsPanel />);
  await waitFor(() =>
    expect(
      view.getByTestId('voice-model-apple-system-speech').props
        .accessibilityState.disabled,
    ).toBe(false),
  );
  await fireEvent.press(view.getByTestId('voice-settings-save'));
  await waitFor(() =>
    expect(view.getByText(/저장하지 못했습니다/)).toBeTruthy(),
  );
});
