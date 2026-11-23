import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Animated, StyleSheet, View } from 'react-native';
import { AdaptiveColumns } from '../../../layout/AdaptiveColumns';
import { NavigationMotionContext } from '../../../navigation/NavigationMotionContext';
import { ModelSelectionTabs } from '../ModelSelectionTabs';

jest.mock('../../../navigation/NavigationGeometryProvider', () => ({
  useNavigationGeometry: () => ({
    safeAreaFrame: { x: 0, y: 0, width: 466, height: 678 },
    usableRegions: [{ x: 0, y: 0, width: 366, height: 678 }],
    reservedRegions: [],
  }),
}));
jest.mock('../../../calendarModelSettings/CalendarModelSettingsPanel', () => ({
  CalendarModelSettingsPanel: () => null,
}));
jest.mock('../../../voiceSettings/VoiceSettingsPanel', () => ({
  VoiceSettingsPanel: () => null,
}));

type Capture = (x: number, y: number, width: number, height: number) => void;
const nativeView = View as unknown as {
  prototype: { measureInWindow: (callback: Capture) => void };
};
const viewport = 'model-tab-content-viewport';
const animatedHost = 'test-provider-columns-host';

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
        screen.getByTestId('test-provider-columns-primary').props.style,
      ).width;
    try {
      await render(
        <NavigationMotionContext.Provider value={reduceMotion}>
          <ModelSelectionTabs enabled locked={false}>
            <AdaptiveColumns
              primary={<View />}
              testID="test-provider-columns"
            />
          </ModelSelectionTabs>
        </NavigationMotionContext.Provider>,
      );
      expect(width()).toBe(345);
      await fireEvent(
        screen.getByTestId('navigation-inline-transition'),
        'layout',
        { nativeEvent: { layout: { x: 0, y: 0, width: 345, height: 600 } } },
      );
      await fireEvent.press(screen.getByTestId('model-tab-calendar'));
      await fireEvent.press(screen.getByTestId('model-tab-voice'));
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
