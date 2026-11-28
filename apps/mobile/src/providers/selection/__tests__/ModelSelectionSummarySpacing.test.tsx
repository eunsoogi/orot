import { fireEvent, render, screen } from '@testing-library/react-native';
import {
  ModelSettingsServicesContext,
  type ModelSettingsServices,
} from '../../../agent/execution/ModelSettingsServices';
import ProviderSelectionScreen from '../ProviderSelectionScreen';

test('does not remount the shared tab rail when switching between model lists', async () => {
  const store = { load: async () => null, save: jest.fn(), clear: jest.fn() };
  const voice: ModelSettingsServices['voice'] = {
    load: async () => ({
      mode: 'local',
      model: 'apple-system-speech',
      hasApiKey: false,
    }),
    save: jest.fn(),
    accountStatus: async () => ({ connected: false, revision: 0 }),
    accountRevisionMatches: revision => revision === 0,
    discoverModels: jest.fn(),
    subscribe: () => () => undefined,
  };
  await render(
    <ModelSettingsServicesContext.Provider
      value={{
        calendar: store,
        voice,
        calendarOption: jest.fn(),
        saveConsent: jest.fn(),
      }}
    >
      <ProviderSelectionScreen
        requirements={{ inputTypes: ['text'] }}
        options={[]}
        presentation="settings-provider"
        selectionStore={store}
      />
    </ModelSettingsServicesContext.Provider>,
  );

  const tab = screen.getByTestId('model-tab-language');
  expect(screen.getByTestId('settings-provider-local-panel')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('model-tab-calendar'));
  expect(screen.getByTestId('calendar-model-settings')).toBeTruthy();
  expect(screen.getByTestId('model-tab-language')).toBe(tab);
  await fireEvent.press(screen.getByTestId('model-tab-voice'));
  expect(await screen.findByTestId('voice-model-group-local')).toBeTruthy();
  expect(screen.getByTestId('model-tab-language')).toBe(tab);
  expect(store.save).not.toHaveBeenCalled();
});
