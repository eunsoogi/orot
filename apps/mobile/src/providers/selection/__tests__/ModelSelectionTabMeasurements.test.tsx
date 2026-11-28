import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Animated, StyleSheet, View } from 'react-native';
import { createAppleSelectionOption } from '../options';
import { ProviderSelectionChoices } from '../ProviderSelectionChoices';
import { NavigationMotionContext } from '../../../navigation/NavigationMotionContext';
import { ModelSelectionTabs } from '../ModelSelectionTabs';

jest.mock('../../../navigation/NavigationGeometryProvider', () => ({
  useNavigationGeometry: () => ({
    safeAreaFrame: { x: 0, y: 0, width: 466, height: 678 },
    usableRegions: [{ x: 0, y: 0, width: 366, height: 678 }],
    reservedRegions: [],
  }),
}));
jest.mock('../../../calendarModelSettings/calendarModelStore', () => ({
  calendarModelStore: jest
    .requireActual(
      '../../../agent/execution/testSupport/modelSettingsServiceFixture',
    )
    .modelSettingsSelectionFixture(),
}));
jest.mock('../../../voiceSettings/voiceSettingsStore', () => ({
  voiceSettingsStore: {
    ...jest
      .requireActual(
        '../../../agent/execution/testSupport/modelSettingsServiceFixture',
      )
      .modelSettingsVoiceFixture(),
    load: jest.fn(async () => ({
      mode: 'local',
      model: 'apple-system-speech',
      hasApiKey: false,
    })),
    accountStatus: jest.fn(async () => ({ connected: false, revision: 1 })),
    subscribe: () => () => {},
  },
}));

const apple = createAppleSelectionOption('available');

type Capture = (x: number, y: number, width: number, height: number) => void;
const nativeView = View as unknown as {
  prototype: { measureInWindow: (callback: Capture) => void };
};
const viewport = 'model-tab-content-viewport';
const animatedHost = 'settings-provider-panels-host';

/** A real measurement consumer remounts while a native-driver movement is still outstanding. */
test.each([false, true])(
  'keeps the catalog in the stationary pane across rapid switches (reduced motion: %s)',
  async reduceMotion => {
    let bounds = { x: 20, width: 345 };
    let hold = false;
    const callbacks: Capture[] = [];
    const measure = jest
      .spyOn(nativeView.prototype, 'measureInWindow')
      .mockImplementation(function (this: { props: { testID?: string } }, cb) {
        if (this.props.testID === animatedHost) cb(346, 0, 345, 600);
        if (this.props.testID === viewport) {
          if (hold) callbacks.push(cb);
          else cb(bounds.x, 0, bounds.width, 600);
        }
      });
    const animation = { start: jest.fn(), stop: jest.fn(), reset: jest.fn() };
    const animate = jest.spyOn(Animated, 'timing').mockReturnValue(animation);
    const width = () =>
      StyleSheet.flatten(
        screen.getByTestId('settings-provider-panels-primary').props.style,
      ).width;
    try {
      await render(
        <NavigationMotionContext.Provider value={reduceMotion}>
          <ModelSelectionTabs enabled locked={false} calendarOptions={[apple]}>
            <ProviderSelectionChoices
              options={[apple]}
              loading={false}
              saving={false}
              pendingOption={null}
              selectedOption={undefined}
              presentation="settings-provider"
              requirements={{ inputTypes: ['text'] }}
              onChoose={jest.fn()}
            />
          </ModelSelectionTabs>
        </NavigationMotionContext.Provider>,
      );
      expect(width()).toBe(345);
      const pillId = 'model-tab-selection-glass';
      const pill = screen.getByTestId(pillId, { includeHiddenElements: true });
      const currentPill = () =>
        screen.getByTestId(pillId, { includeHiddenElements: true });
      expect(pill.props.pointerEvents).toBe('none');
      expect(pill.props.selectionTarget).toBeUndefined();
      for (const [id, x, tabWidth] of [
        ['language', 3, 96],
        ['calendar', 99, 132],
        ['voice', 231, 108],
      ] as const) {
        await fireEvent(screen.getByTestId(`model-tab-${id}`), 'layout', {
          nativeEvent: { layout: { x, y: 3, width: tabWidth, height: 44 } },
        });
      }
      expect(currentPill().props.selectionTarget).toMatchObject({
        x: 3,
        width: 96,
        animated: false,
      });
      await fireEvent(
        screen.getByTestId('navigation-inline-transition'),
        'layout',
        { nativeEvent: { layout: { x: 0, y: 0, width: 345, height: 600 } } },
      );
      await fireEvent.press(screen.getByTestId('model-tab-calendar'));
      expect(screen.getByTestId('calendar-model-settings')).toBeTruthy();
      expect(currentPill()).toBe(pill);
      expect(currentPill().props.selectionTarget).toMatchObject({
        x: 99,
        width: 132,
        animated: !reduceMotion,
      });
      expect(width()).toBe(345);
      await fireEvent.press(screen.getByTestId('model-tab-voice'));
      expect(screen.getByTestId('voice-settings-panel')).toBeTruthy();
      expect(currentPill()).toBe(pill);
      expect(currentPill().props.selectionTarget).toMatchObject({
        x: 231,
        width: 108,
        animated: !reduceMotion,
      });
      expect(screen.getByTestId('voice-model-group-local')).toBeTruthy();
      expect(screen.queryByTestId(animatedHost)).toBeNull();
      await fireEvent.press(screen.getByTestId('model-tab-language'));
      expect(width()).toBe(345);
      expect(animation.start).toHaveBeenCalledTimes(reduceMotion ? 0 : 3);
      expect(animation.stop).toHaveBeenCalledTimes(reduceMotion ? 0 : 2);

      // Native geometry changes can complete out of order. The older width must not replace the newest.
      hold = true;
      const layout = (w: number) =>
        fireEvent(screen.getByTestId(animatedHost), 'layout', {
          nativeEvent: { layout: { x: 0, y: 0, width: w, height: 600 } },
        });
      await layout(345);
      await layout(310);
      expect(callbacks).toHaveLength(2);
      bounds = { x: 24, width: 310 };
      await act(() => {
        callbacks[1]!(bounds.x, 0, bounds.width, 600);
        callbacks[0]!(20, 0, 345, 600);
      });
      expect(width()).toBe(310);
    } finally {
      measure.mockRestore();
      animate.mockRestore();
    }
  },
);
