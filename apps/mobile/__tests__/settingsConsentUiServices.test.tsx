import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { openSqliteTestDatabase } from '../../../packages/storage/__tests__/sqliteTestDatabase';
import { createSettingsConsentUiServices } from '../e2e/settingsConsentUiServices';
import { SettingsConsentNativeProbe } from '../e2e/SettingsConsentNativeProbe';
import type { ConsentAuthorityState } from '../src/agent/execution/consentAuthority';
import type { ProviderSelection } from '../src/providers/selection/types';
import { voiceSettingsStore } from '../src/voiceSettings/voiceSettingsStore';
import { calendarModelStore } from '../src/calendarModelSettings/calendarModelStore';
import type { SettingsConsentSlot } from '../src/storage/settingsConsentStorage';

// The real screen and tab panels use synthetic services, not application singletons.
test('native probe mounts real tabs with isolated services and no model invocation', async () => {
  const db = openSqliteTestDatabase(':memory:');
  const states = new Map<SettingsConsentSlot, ConsentAuthorityState>();
  const selections = new Map<SettingsConsentSlot, ProviderSelection>();
  let sequence = 0;
  const input = createSettingsConsentUiServices({
    database: db.database,
    generation: () => (++sequence).toString(16).padStart(64, '0'),
    authority: slot => ({
      read: async () => states.get(slot) ?? null,
      write: async state => {
        states.set(slot, state);
      },
    }),
    selection: slot => ({
      load: async () => selections.get(slot) ?? null,
      save: async value => {
        selections.set(slot, value);
      },
      clear: async () => {
        selections.delete(slot);
      },
    }),
  });
  const noNative = () => {
    throw new Error('Unexpected production service fallback');
  };
  const forbidden = [
    jest.spyOn(voiceSettingsStore, 'load').mockImplementation(noNative),
    jest
      .spyOn(voiceSettingsStore, 'accountStatus')
      .mockImplementation(noNative),
    jest
      .spyOn(voiceSettingsStore, 'discoverModels')
      .mockImplementation(noNative),
    jest.spyOn(calendarModelStore, 'load').mockImplementation(noNative),
    jest.spyOn(globalThis, 'fetch').mockImplementation(noNative),
  ];
  const provider = jest.spyOn(input.options[0].provider, 'generate');
  try {
    const view = await render(<SettingsConsentNativeProbe input={input} />);
    await waitFor(() =>
      expect(view.getByTestId('model-tab-language')).toBeTruthy(),
    );
    await waitFor(() =>
      expect(
        view.getByTestId('provider-option-0').props.accessibilityState.disabled,
      ).toBe(false),
    );
    await fireEvent.press(view.getByTestId('provider-option-0'));
    expect(
      view.getByTestId('model-settings-transmission-disclosure'),
    ).toHaveTextContent(/^전송받는 곳: 선택한 ChatGPT 계정\s/);
    await fireEvent.press(view.getByTestId('provider-selection-confirm'));
    await waitFor(() =>
      expect(states.get('conversation')?.status).toBe('active'),
    );
    await fireEvent.press(view.getByTestId('model-tab-calendar'));
    await waitFor(() =>
      expect(
        view.getByTestId('calendar-model-refresh').props.accessibilityState
          .disabled,
      ).toBe(false),
    );
    await fireEvent.press(view.getByTestId('calendar-model-refresh'));
    await waitFor(() =>
      expect(view.getByTestId('provider-option-1')).toBeTruthy(),
    );
    await fireEvent.press(view.getByTestId('provider-option-1'));
    expect(
      view.getByTestId('model-settings-transmission-disclosure'),
    ).toHaveTextContent(/^전송받는 곳: OpenAI API\s/);
    await fireEvent.press(view.getByTestId('provider-selection-confirm'));
    await waitFor(() => expect(states.get('calendar')?.status).toBe('active'));
    await fireEvent.press(view.getByTestId('model-tab-voice'));
    await waitFor(() =>
      expect(view.getByTestId('voice-model-refresh')).toBeTruthy(),
    );
    await fireEvent.press(view.getByTestId('voice-model-refresh'));
    await waitFor(() =>
      expect(
        view.getByTestId('voice-model-gpt-realtime-2.1-mini'),
      ).toBeTruthy(),
    );
    await fireEvent.press(
      view.getByTestId('voice-model-gpt-realtime-2.1-mini'),
    );
    expect(
      view.getByTestId('model-settings-transmission-disclosure'),
    ).toHaveTextContent(/^전송받는 곳: OpenAI Realtime API\s/);
    await fireEvent.press(view.getByTestId('voice-settings-save'));
    await waitFor(() => expect(states.get('voice')?.status).toBe('active'));
    expect((await input.fixture.inspect()).observations.voice).toBe(
      'authorized',
    );
    expect((await input.fixture.inspect()).observations).toEqual({
      conversation: 'authorized',
      calendar: 'authorized',
      voice: 'authorized',
    });
    expect(provider).not.toHaveBeenCalled();
    for (const spy of forbidden) expect(spy).not.toHaveBeenCalled();
    await act(() => view.unmount());
  } finally {
    for (const spy of forbidden) spy.mockRestore();
    db.close();
  }
});
