import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import {
  ModelSettingsServicesContext,
  type ModelSettingsServices,
} from '../../../agent/execution/ModelSettingsServices';
import ProviderSelectionScreen from '../ProviderSelectionScreen';

test('uses the same spacing below the selection summary in all three Settings tabs', async () => {
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

  const gap = StyleSheet.flatten(
    screen.getByTestId('settings-provider-screen').props.contentContainerStyle,
  ).gap;
  const firstAppleSectionMargin = (id: string) =>
    StyleSheet.flatten(screen.getByTestId(id).props.style).marginTop;
  const language =
    gap + firstAppleSectionMargin('settings-provider-local-panel');

  await fireEvent.press(screen.getByTestId('model-tab-calendar'));
  const calendar = firstAppleSectionMargin('settings-provider-local-panel');
  await fireEvent.press(screen.getByTestId('model-tab-voice'));
  await screen.findByTestId('voice-current-model-card');
  const voiceMargin = firstAppleSectionMargin('voice-model-group-local');

  expect(calendar).toBeGreaterThan(0);
  expect(voiceMargin).toBe(calendar);
  expect(language).toBe(calendar);
  expect(store.save).not.toHaveBeenCalled();
});
