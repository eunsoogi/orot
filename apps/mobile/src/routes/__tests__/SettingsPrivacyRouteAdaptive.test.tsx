import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Alert, Dimensions, StyleSheet, Text, View } from 'react-native';
import { NavigationRouteAdapter } from '../../navigation/NavigationRouteAdapter';
import { appContentLayoutOwner } from '../../navigation/appContentLayoutPolicy';
import { createNavigationController } from '../../navigation/navigationController';
import type { NavigationGeometryPayload } from '../../navigation/navigationGeometry';
import { resetInferenceConsentReceipts } from '../../storage/inferenceConsentStorage';
import type { AppNavigationRoute } from '../appNavigationRoute';
import { SettingsPrivacyRoute } from '../SettingsPrivacyRoute';

jest.mock('../../storage/inferenceConsentStorage', () => ({
  resetInferenceConsentReceipts: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => {
  const React = require('react') as typeof import('react');
  return {
    SafeAreaInsetsContext: React.createContext({
      top: 0,
      left: 0,
      right: 0,
      bottom: 34,
    }),
    useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 34 }),
    SafeAreaProvider: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    SafeAreaView: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

const originalWindow = Dimensions.get('window');
const originalScreen = Dimensions.get('screen');
const measuredBounds = new Map<
  string,
  { readonly x: number; readonly width: number }
>();
const measurableView = View as unknown as {
  prototype: {
    measureInWindow: (
      callback: (x: number, y: number, width: number, height: number) => void,
    ) => void;
  };
};
const noInsets = { top: 0, right: 0, bottom: 0, left: 0 };

function viewport(width: number, fontScale = 1) {
  return { ...originalWindow, width, height: 800, scale: 1, fontScale };
}

function geometry(width: number, divided: boolean): NavigationGeometryPayload {
  return {
    windowBounds: { x: 0, y: 0, width, height: 800 },
    safeAreaInsets: noInsets,
    reservedRegionsSupported: divided,
    reservedRegions: divided
      ? [
          {
            id: 'privacy-division',
            kind: 'division',
            frame: { x: 760, y: 0, width: 16, height: 800 },
            margins: noInsets,
            isActive: true,
          },
          {
            id: 'privacy-right-rail',
            kind: 'occlusion',
            frame: { x: width - 60, y: 0, width: 60, height: 800 },
            margins: noInsets,
            isActive: true,
          },
        ]
      : [],
  };
}

function columnsAxis() {
  return StyleSheet.flatten(
    screen.getByTestId('settings-privacy-columns').props.style,
  )?.flexDirection;
}

beforeEach(() => {
  measuredBounds.clear();
  Dimensions.set({ window: viewport(1600), screen: viewport(1600) });
  jest
    .spyOn(measurableView.prototype, 'measureInWindow')
    .mockImplementation(function (
      this: { readonly props: { readonly testID?: string } },
      callback,
    ) {
      const bounds = measuredBounds.get(this.props.testID ?? '');
      if (bounds) callback(bounds.x, 0, bounds.width, 800);
    });
});

afterEach(() => {
  jest.restoreAllMocks();
  Dimensions.set({ window: originalWindow, screen: originalScreen });
});

test('uses native privacy regions and retains confirmation, progress, and cleared state through reflow', async () => {
  const controller = createNavigationController<AppNavigationRoute>('home');
  const reset = jest.mocked(resetInferenceConsentReceipts);
  const alert = jest.spyOn(Alert, 'alert');
  let finishClear: (() => void) | undefined;
  reset.mockReturnValue(
    new Promise<void>(resolve => {
      finishClear = resolve;
    }),
  );
  measuredBounds.set('settings-privacy-columns-host', { x: 24, width: 1500 });

  await render(
    <NavigationRouteAdapter
      contentLayoutOwner={appContentLayoutOwner}
      controller={controller}
    >
      {actions =>
        actions.route.name === 'settings-privacy' ? (
          <SettingsPrivacyRoute />
        ) : (
          <Text testID="home-route">Home</Text>
        )
      }
    </NavigationRouteAdapter>,
  );
  await act(async () => {
    controller.push('settings-privacy');
  });

  expect(typeof appContentLayoutOwner).toBe('function');
  if (typeof appContentLayoutOwner === 'function') {
    expect(appContentLayoutOwner(controller.getSnapshot().currentRoute)).toBe(
      'screen',
    );
  }
  expect(
    screen.queryByTestId(
      `navigation-route-columns-${controller.getSnapshot().currentRoute.key}`,
    ),
  ).toBeNull();
  expect(screen.getByTestId('settings-privacy-permissions')).toBeTruthy();
  expect(screen.getByTestId('settings-privacy-external-transfer')).toBeTruthy();
  expect(columnsAxis()).toBe('row');

  await fireEvent(
    screen.getByTestId('navigation-window-geometry-sensor'),
    'geometryChange',
    { nativeEvent: geometry(1600, true) },
  );
  expect(columnsAxis()).toBe('row');
  expect(
    StyleSheet.flatten(
      screen.getByTestId('settings-privacy-columns-primary').props.style,
    )?.width,
  ).toBeGreaterThan(320);

  await fireEvent.press(screen.getByTestId('inference-consent-clear'));
  expect(alert).toHaveBeenCalledTimes(1);
  expect(reset).not.toHaveBeenCalled();
  alert.mock.calls[0]?.[2]?.[0]?.onPress?.();
  expect(reset).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId('inference-consent-clear'));
  await act(async () => {
    alert.mock.calls[1]?.[2]?.[1]?.onPress?.();
  });
  expect(
    screen.getByTestId('inference-consent-clear').props.accessibilityState
      ?.disabled,
  ).toBe(true);
  expect(screen.getByTestId('inference-consent-clearing')).toBeTruthy();
  expect(
    screen.getByTestId('privacy-open-system-settings').props.accessibilityState
      ?.disabled,
  ).toBe(true);

  await act(async () => {
    expect(await controller.requestBack()).toBe(false);
  });
  expect(controller.getSnapshot().currentRoute.name).toBe('settings-privacy');

  measuredBounds.set('settings-privacy-columns-host', { x: 24, width: 552 });
  await act(async () => {
    Dimensions.set({ window: viewport(600, 2), screen: viewport(600, 2) });
  });
  await fireEvent(
    screen.getByTestId('navigation-window-geometry-sensor'),
    'geometryChange',
    { nativeEvent: geometry(600, false) },
  );
  expect(columnsAxis()).toBe('column');
  expect(screen.getByTestId('inference-consent-clearing')).toBeTruthy();

  await act(async () => finishClear?.());
  await waitFor(() =>
    expect(screen.getByText(/동의 내역을 지웠어요/u)).toBeTruthy(),
  );
  expect(
    screen.getByTestId('inference-consent-clear').props.accessibilityState
      ?.disabled,
  ).toBe(false);
  expect(controller.getSnapshot().currentRoute.name).toBe('settings-privacy');
});
