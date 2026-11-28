// View persistence boundary; actual settings grant activation is covered with SQLite service tests.
jest.mock('../../agent/execution/saveModelSettingsConsent', () => ({
  saveModelSettingsConsent: async (input: {
    store: { save(value: unknown): Promise<void> };
    selection: unknown;
  }) => input.store.save(input.selection),
}));
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Animated, Button, Text, View, StyleSheet } from 'react-native';
import { ModelSelectionTabs } from '../../providers/selection/ModelSelectionTabs';
import {
  NavigationPrimaryActionContext,
  useNavigationPrimaryActionHost,
} from '../../navigation/useNavigationPrimaryAction';
import { NavigationMotionContext } from '../../navigation/NavigationMotionContext';
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
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../voiceRuntimeCapability', () => ({
  hasLiveVoiceRuntime: () => true,
  hasLiveResponsesRuntime: () => true,
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
    .mockResolvedValue({ revision: 3, ids: ['gpt-live-1.1', 'gpt-6-luna'] });
  jest.mocked(voiceSettingsStore.save).mockResolvedValue();
});
it('shares tab and section presentation and routes voice confirmation only while visible', async () => {
  const view = await render(<Fixture />);
  expect(
    StyleSheet.flatten(view.getByTestId('model-tab-language').props.style),
  ).toMatchObject(sectionTabStyles.tab);
  expect(view.getByTestId('model-tab-language')).toHaveProp(
    'accessibilityState',
    expect.objectContaining({ selected: true }),
  );
  expect(
    view.getByTestId('model-tab-selection-glass', {
      includeHiddenElements: true,
    }),
  ).toHaveProp('pointerEvents', 'none');
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
    expect(view.getByTestId('voice-model-gpt-live-1.1')).toBeTruthy(),
  );
  await fireEvent.press(view.getByTestId('voice-model-gpt-live-1.1'));
  await fireEvent.press(view.getByTestId('model-tab-language'));
  expect(view.queryByTestId('dock-confirm-voice-model')).toBeNull();
  expect(voiceSettingsStore.save).not.toHaveBeenCalled();
  await fireEvent.press(view.getByTestId('model-tab-voice'));
  expect(
    view.getByTestId('voice-model-gpt-live-1.1').props.accessibilityState
      .selected,
  ).toBe(true);
  expect(view.getByTestId('dock-confirm-voice-model')).toBeDisabled();
  await fireEvent.press(view.getByTestId('voice-tool-model-gpt-6-luna'));
  await fireEvent.press(view.getByTestId('dock-confirm-voice-model'));
  await view.findByTestId('inference-disclosure-allow');
  await fireEvent.press(view.getByTestId('model-tab-language'));
  expect(view.queryByTestId('inference-disclosure-allow')).toBeNull();
  expect(voiceSettingsStore.save).not.toHaveBeenCalled();
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
    resolve({ revision: 3, ids: ['gpt-live-1.1', 'gpt-6-luna'] });
  });
  expect(view.queryByTestId('dock-confirm-voice-model')).toBeNull();
  await fireEvent.press(view.getByTestId('model-tab-voice'));
  expect(view.getByTestId('voice-model-gpt-live-1.1')).toBeEnabled();
  expect(voiceSettingsStore.discoverModels).toHaveBeenCalledTimes(1);
});

it('slides the active pane in index order while tabs stay fixed; rapid switch and Reduce Motion cancel movement', async () => {
  const stop = jest.fn();
  const isBodyMotion = ({
    duration,
    toValue,
    useNativeDriver,
  }: Parameters<typeof Animated.timing>[1]) =>
    duration === 200 && toValue === 0 && useNativeDriver;
  const timing = jest
    .spyOn(Animated, 'timing')
    .mockImplementation((_value, config) => ({
      start: jest.fn(),
      stop: isBodyMotion(config) ? stop : jest.fn(),
      reset: jest.fn(),
    }));
  const bodyMotionCalls = () =>
    timing.mock.calls.filter(([, config]) => isBodyMotion(config));
  const fixture = (reduceMotion: boolean) => (
    <NavigationMotionContext.Provider value={reduceMotion}>
      <Fixture />
    </NavigationMotionContext.Provider>
  );
  try {
    const view = await render(fixture(false));
    const pane = () => view.getByTestId('navigation-inline-transition');
    const tab = (key: string) => view.getByTestId(`model-tab-${key}`);
    expect(view.getByTestId('model-tab-content-viewport')).toHaveStyle({
      overflow: 'hidden',
    });
    expect(pane()).not.toContainElement(tab('language'));
    expect(pane()).toContainElement(view.getByText('Language choices'));
    expect(pane()).toHaveStyle({ transform: [{ translateX: 0 }] });
    expect(bodyMotionCalls()).toHaveLength(0);
    await fireEvent(pane(), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 420, height: 320 } },
    });
    await fireEvent.press(tab('calendar'));
    expect(pane()).toHaveStyle({
      opacity: 1,
      transform: [{ translateX: 420 }],
    });
    expect(view.queryByText('Language choices')).toBeNull();
    await fireEvent.press(tab('voice'));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(pane()).toHaveStyle({
      opacity: 1,
      transform: [{ translateX: 420 }],
    });
    await fireEvent.press(tab('language'));
    expect(stop).toHaveBeenCalledTimes(2);
    expect(pane()).toHaveStyle({
      opacity: 1,
      transform: [{ translateX: -420 }],
    });
    expect(pane()).toContainElement(view.getByText('Language choices'));
    expect(tab('language').props.accessibilityState.selected).toBe(true);
    await fireEvent.press(tab('language'));
    expect(bodyMotionCalls()).toHaveLength(3);
    expect(bodyMotionCalls()[2]?.[0]).toBeInstanceOf(Animated.Value);
    await view.rerender(fixture(true));
    expect(stop).toHaveBeenCalledTimes(3);
    await fireEvent.press(tab('voice'));
    expect(pane()).toHaveStyle({ transform: [{ translateX: 0 }] });
    expect(bodyMotionCalls()).toHaveLength(3);
    expect(tab('voice').props.accessibilityState.selected).toBe(true);
    expect(voiceSettingsStore.save).not.toHaveBeenCalled();
  } finally {
    timing.mockRestore();
  }
});
