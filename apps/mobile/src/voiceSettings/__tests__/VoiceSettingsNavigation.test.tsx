import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Button, Text, View, StyleSheet } from 'react-native';
import { ModelSelectionTabs } from '../../providers/selection/ModelSelectionTabs';
import {
  NavigationPrimaryActionContext,
  useNavigationPrimaryActionHost,
} from '../../navigation/useNavigationPrimaryAction';
import { voiceSettingsStore } from '../voiceSettingsStore';
import { providerSettingsStyles } from '../../layout/providerSettingsPresentation';
import { sectionTabStyles } from '../../layout/sectionTabPresentation';

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
  hasRealtimeVoiceRuntime: () => false,
}));
function Fixture() {
  const { host, actions } = useNavigationPrimaryActionHost('models');
  return (
    <NavigationPrimaryActionContext.Provider value={host}>
      <ModelSelectionTabs enabled locked={false}>
        <Text>Language choices</Text>
      </ModelSelectionTabs>
      <View>
        {actions.map(action => (
          <Button
            key={action.id}
            title={action.label}
            disabled={action.disabled}
            testID={`dock-${action.id}`}
            onPress={() => {
              action.onPress();
            }}
          />
        ))}
      </View>
    </NavigationPrimaryActionContext.Provider>
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(voiceSettingsStore.load).mockResolvedValue({
    mode: 'local',
    model: 'apple-system-speech',
    hasApiKey: true,
  });
  jest
    .mocked(voiceSettingsStore.accountStatus)
    .mockResolvedValue({ connected: true, revision: 3 });
  jest
    .mocked(voiceSettingsStore.discoverModels)
    .mockResolvedValue({ revision: 3, ids: ['gpt-realtime-2.1-mini'] });
  jest.mocked(voiceSettingsStore.save).mockResolvedValue();
});
it('shares tab and section presentation and routes voice confirmation only while visible', async () => {
  const view = await render(<Fixture />);
  expect(
    StyleSheet.flatten(view.getByTestId('model-tab-language').props.style),
  ).toMatchObject(StyleSheet.flatten(sectionTabStyles.selectedTab));
  await fireEvent.press(view.getByTestId('model-tab-voice'));
  await waitFor(() =>
    expect(view.getByTestId('dock-confirm-voice-model')).toBeEnabled(),
  );
  expect(view.queryByTestId('voice-settings-save')).toBeNull();
  expect(view.getByTestId('voice-model-group-local').parent).toBe(
    view.getByTestId('voice-model-group-openai-api').parent,
  );
  expect(StyleSheet.flatten(view.getByText('Apple').props.style)).toEqual(
    StyleSheet.flatten(providerSettingsStyles.heading),
  );
  expect(
    StyleSheet.flatten(
      view.getByTestId('voice-model-apple-system-speech').props.style,
    ),
  ).toEqual(StyleSheet.flatten(providerSettingsStyles.option));
  await fireEvent.press(view.getByTestId('voice-model-refresh'));
  await waitFor(() =>
    expect(view.getByTestId('voice-model-gpt-realtime-2.1-mini')).toBeTruthy(),
  );
  await fireEvent.press(view.getByTestId('voice-model-gpt-realtime-2.1-mini'));
  await fireEvent.press(view.getByTestId('model-tab-language'));
  expect(view.queryByTestId('dock-confirm-voice-model')).toBeNull();
  expect(voiceSettingsStore.save).not.toHaveBeenCalled();
  await fireEvent.press(view.getByTestId('model-tab-voice'));
  expect(
    view.getByTestId('voice-model-gpt-realtime-2.1-mini').props
      .accessibilityState.selected,
  ).toBe(true);
  await fireEvent.press(view.getByTestId('dock-confirm-voice-model'));
  await waitFor(() =>
    expect(voiceSettingsStore.save).toHaveBeenCalledWith({
      mode: 'openai-api',
      model: 'gpt-realtime-2.1-mini',
      expectedAccountRevision: 3,
    }),
  );
  expect(voiceSettingsStore.save).toHaveBeenCalledTimes(1);
});
it('retains a catalog completion across tabs without registering a hidden action', async () => {
  let resolve!: (value: { revision: number; ids: string[] }) => void;
  jest.mocked(voiceSettingsStore.discoverModels).mockReturnValue(
    new Promise(r => {
      resolve = r;
    }),
  );
  const view = await render(<Fixture />);
  await fireEvent.press(view.getByTestId('model-tab-voice'));
  await waitFor(() =>
    expect(view.getByTestId('voice-model-refresh')).toBeEnabled(),
  );
  await fireEvent.press(view.getByTestId('voice-model-refresh'));
  await fireEvent.press(view.getByTestId('model-tab-language'));
  await act(async () => {
    resolve({ revision: 3, ids: ['gpt-realtime-2.1-mini'] });
  });
  expect(view.queryByTestId('dock-confirm-voice-model')).toBeNull();
  await fireEvent.press(view.getByTestId('model-tab-voice'));
  expect(view.getByTestId('voice-model-gpt-realtime-2.1-mini')).toBeEnabled();
  expect(voiceSettingsStore.discoverModels).toHaveBeenCalledTimes(1);
});
