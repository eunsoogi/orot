import { fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions, NativeModules, Text } from 'react-native';
import { NavigationGeometryProvider } from '../../navigation/NavigationGeometryProvider';
import { NavigationContentFrameContext } from '../../navigation/navigationContentFrame';
import { useConversationWorkspaceBounds } from '../useConversationWorkspaceBounds';

const windowFrame = { x: 0, y: 0, width: 951, height: 669 };
const routeFrame = { x: 20, y: 58, width: 851, height: 611 };
const payload = {
  hasHinge: true,
  navigationSide: 'right' as const,
  windowBounds: windowFrame,
  viewportBounds: windowFrame,
  safeAreaInsets: { top: 58, bottom: 34, left: 0, right: 0 },
  reservedRegionsSupported: true,
  reservedRegions: [],
};

function RoutedDock() {
  const { plan } = useConversationWorkspaceBounds('synthetic-conversation');
  return (
    <Text testID="synthetic-dock-bottom">
      {routeFrame.y + plan.top + plan.height}
    </Text>
  );
}

test.each([false, true])(
  'the routed keyboard produces closed labels only when opted in: %s',
  async enabled => {
    const original = Dimensions.get('window');
    const diagnostics = NativeModules.OrotProviderDiagnostics;
    const report = jest.fn();
    NativeModules.OrotProviderDiagnostics = {
      conversationKeyboardEnabled: enabled,
      report,
    };
    Dimensions.set({ window: { ...original, ...windowFrame, fontScale: 1 } });
    const view = await render(
      <NavigationGeometryProvider>
        <NavigationContentFrameContext.Provider
          value={{
            windowFrame,
            viewportFrame: routeFrame,
            availableContentFrame: routeFrame,
            reservedRegions: [],
            side: 'right',
            navigationFrame: null,
          }}
        >
          <RoutedDock />
        </NavigationContentFrameContext.Provider>
      </NavigationGeometryProvider>,
    );
    try {
      const sensor = screen.getByTestId('navigation-window-geometry-sensor');
      const bottom = () => screen.getByTestId('synthetic-dock-bottom');
      const dockedKeyboardFrame = { x: 0, y: 430, width: 951, height: 239 };
      await fireEvent(sensor, 'geometryChange', { nativeEvent: payload });
      expect(bottom()).toHaveTextContent('669');
      await fireEvent(sensor, 'geometryChange', {
        nativeEvent: { ...payload, dockedKeyboardFrame },
      });
      expect(bottom()).toHaveTextContent('430');
      await fireEvent(sensor, 'geometryChange', {
        nativeEvent: { ...payload, dockedKeyboardFrame },
      });
      await fireEvent(sensor, 'geometryChange', { nativeEvent: payload });
      expect(bottom()).toHaveTextContent('669');
      expect(report.mock.calls).toEqual(
        enabled
          ? [
              ['navigation', 'conversation_keyboard_clip', 'no-native-frame'],
              ['navigation', 'conversation_keyboard_clip', 'clipped'],
              ['navigation', 'conversation_keyboard_clip', 'no-native-frame'],
            ]
          : [],
      );
    } finally {
      await view.unmount();
      NativeModules.OrotProviderDiagnostics = diagnostics;
      Dimensions.set({ window: original });
    }
  },
);
