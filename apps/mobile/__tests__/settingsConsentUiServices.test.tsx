import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { openSqliteTestDatabase } from '../../../packages/storage/__tests__/sqliteTestDatabase';
import { createSettingsConsentUiServices } from '../e2e/settingsConsentUiServices';
import { SettingsConsentNativeProbe } from '../e2e/SettingsConsentNativeProbe';
import type { ConsentAuthorityState } from '../src/agent/execution/consentAuthority';
import type { ProviderSelection } from '../src/providers/selection/types';
import { voiceSettingsStore } from '../src/voiceSettings/voiceSettingsStore';
import { calendarModelStore } from '../src/calendarModelSettings/calendarModelStore';
import type { SettingsConsentSlot } from '../src/storage/settingsConsentStorage';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('../src/voiceSettings/voiceRuntimeCapability', () => ({
  ...jest.requireActual('../src/voiceSettings/voiceRuntimeCapability'),
  hasLiveVoiceRuntime: () => true,
}));

// The real screen and tab panels use synthetic services, not application singletons.
test('conversation and calendar Save require shared disclosure before grants and never invoke a provider', async () => {
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
      view.queryByTestId('model-settings-transmission-disclosure'),
    ).toBeNull();
    expect(view.queryByTestId('inference-disclosure-sheet')).toBeNull();
    await fireEvent.press(view.getByTestId('provider-selection-confirm'));
    expect(
      await view.findByTestId('inference-disclosure-recipient'),
    ).toHaveTextContent('선택한 ChatGPT 계정');
    expect(states.get('conversation')).toBeUndefined();
    expect(view.getByTestId('inference-disclosure-allow')).toHaveProp(
      'accessibilityLabel',
      '동의',
    );
    await fireEvent.press(view.getByTestId('inference-disclosure-cancel'));
    expect(states.get('conversation')).toBeUndefined();
    await fireEvent.press(view.getByTestId('provider-selection-confirm'));
    await fireEvent.press(
      await view.findByTestId('inference-disclosure-allow'),
    );
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
      view.queryByTestId('model-settings-transmission-disclosure'),
    ).toBeNull();
    expect(view.queryByTestId('inference-disclosure-sheet')).toBeNull();
    await fireEvent.press(view.getByTestId('provider-selection-confirm'));
    expect(
      await view.findByTestId('inference-disclosure-recipient'),
    ).toHaveTextContent('OpenAI API');
    expect(states.get('calendar')).toBeUndefined();
    expect(view.getByTestId('inference-disclosure-allow')).toHaveProp(
      'accessibilityLabel',
      '동의',
    );
    await fireEvent.press(
      await view.findByTestId('inference-disclosure-allow'),
    );
    await waitFor(() => expect(states.get('calendar')?.status).toBe('active'));
    await fireEvent.press(view.getByTestId('model-tab-voice'));
    await fireEvent.press(await view.findByTestId('voice-model-refresh'));
    const voice = await view.findByTestId('voice-model-gpt-live-1.1');
    await fireEvent.press(voice);
    expect(view.queryByTestId('inference-disclosure-sheet')).toBeNull();
    await fireEvent.press(view.getByTestId('voice-settings-save'));
    expect(
      await view.findByTestId('inference-disclosure-recipient'),
    ).toHaveTextContent('OpenAI Live API');
    expect(states.get('voice')).toBeUndefined();
    expect(view.getByTestId('inference-disclosure-allow')).toHaveProp(
      'accessibilityLabel',
      '동의',
    );
    await fireEvent.press(view.getByTestId('inference-disclosure-allow'));
    await waitFor(() => expect(states.get('voice')?.status).toBe('active'));
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
