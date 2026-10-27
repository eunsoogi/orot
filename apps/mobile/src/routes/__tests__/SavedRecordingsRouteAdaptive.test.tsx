import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { appContentLayoutOwner } from '../../navigation/appContentLayoutPolicy';
import { createNavigationController } from '../../navigation/navigationController';
import { NavigationRouteAdapter } from '../../navigation/NavigationRouteAdapter';
import { RecordingSelectionProvider } from '../../recording/RecordingSelectionContext';
import {
  confirmNativeDeletion,
  mockNativeDeletionAlert,
} from '../../recording/testSupport/nativeDeletionAlert';
import { SavedRecordingsRoute } from '../SavedRecordingsRoute';
import type { AppNavigationRoute } from '../appNavigationRoute';
import {
  cleanReviewLeaveState,
  createLibraryService,
  geometry,
  leftUsableRegionWidth,
  source,
} from '../testSupport/savedRecordingsRouteAdaptiveTestSupport';

jest.mock('../../recording/useAutomaticRecordingTranscription', () => ({
  useAutomaticRecordingTranscription: () => ({
    cancel: jest.fn(),
    state: null,
  }),
}));

const measurableView = View as unknown as {
  prototype: {
    measureInWindow: (
      callback: (x: number, y: number, width: number, height: number) => void,
    ) => void;
  };
};
jest
  .spyOn(measurableView.prototype, 'measureInWindow')
  .mockImplementation(() => {});

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
const viewport = (width: number, fontScale = 1) => ({
  ...originalWindow,
  width,
  height: 700,
  scale: 1,
  fontScale,
});

beforeEach(() => {
  Dimensions.set({ window: viewport(900), screen: viewport(900) });
});

afterEach(() => {
  Dimensions.set({ window: originalWindow, screen: originalScreen });
  jest.restoreAllMocks();
});

test('preserves the selected summary as usable geometry changes under production route policy', async () => {
  const controller = createNavigationController<AppNavigationRoute>('home');
  const service = createLibraryService();

  await render(
    <RecordingSelectionProvider>
      <NavigationRouteAdapter
        contentLayoutOwner={appContentLayoutOwner}
        controller={controller}
        leaveState={cleanReviewLeaveState}
      >
        {actions =>
          actions.route.name === 'saved-recordings' ? (
            <SavedRecordingsRoute actions={actions} libraryService={service} />
          ) : actions.route.name === 'recording-review' ? (
            <Pressable onPress={actions.onBack} testID="recording-review-back">
              <Text>Review</Text>
            </Pressable>
          ) : (
            <Text testID="home-route">Home</Text>
          )
        }
      </NavigationRouteAdapter>
    </RecordingSelectionProvider>,
  );

  await act(async () => {
    controller.push('saved-recordings');
  });
  const savedRouteKey = controller.getSnapshot().currentRoute.key;
  expect(
    screen.queryByTestId(`navigation-route-columns-${savedRouteKey}`),
  ).toBeNull();
  await screen.findByTestId('recording-library-item-recording-source');
  const sensor = screen.getByTestId('navigation-window-geometry-sensor');
  const direction = () =>
    StyleSheet.flatten(
      screen.getByTestId('saved-recordings-layout').props.style,
    )?.flexDirection;
  const columnWidth = (side: 'primary' | 'secondary') =>
    StyleSheet.flatten(
      screen.getByTestId(`saved-recordings-layout-${side}`).props.style,
    )?.width;
  await fireEvent(sensor, 'geometryChange', {
    nativeEvent: geometry(900, true),
  });
  expect(direction()).toBe('column');
  expect(columnWidth('primary')).toBeLessThanOrEqual(leftUsableRegionWidth);
  await fireEvent.press(
    screen.getByTestId('recording-details-recording-source'),
  );

  expect(screen.getByTestId('recording-review-back')).toBeTruthy();
  const reviewRouteKey = controller.getSnapshot().currentRoute.key;
  // The review stub has no edits, so the route adapter uses its clean leave-state source.
  expect(
    screen.getByTestId(`navigation-route-columns-${reviewRouteKey}`),
  ).toBeTruthy();
  await fireEvent.press(screen.getByTestId('recording-review-back'));
  await waitFor(() => {
    expect(controller.getSnapshot().currentRoute.key).toBe(savedRouteKey);
  });

  await screen.findByTestId('saved-recordings-selection-summary');
  expect(
    screen.getByTestId('saved-recordings-selection-title'),
  ).toHaveTextContent(/^Saved recording$/);
  expect(
    screen.getByTestId('saved-recordings-selection-duration'),
  ).toHaveTextContent('01:33');
  expect(
    screen.getByTestId('saved-recordings-selection-review-state'),
  ).toHaveTextContent('검토 전 초안');
  await fireEvent(sensor, 'geometryChange', {
    nativeEvent: geometry(900, true),
  });
  expect(direction()).toBe('row');
  expect(columnWidth('primary')).toBeGreaterThan(320);
  expect(columnWidth('secondary')).toBeGreaterThan(320);
  expect(screen.getByTestId('saved-recordings-selection-summary')).toBeTruthy();

  await act(async () => {
    Dimensions.set({ window: viewport(500), screen: viewport(500) });
    await fireEvent(sensor, 'geometryChange', {
      nativeEvent: geometry(500, false),
    });
  });
  expect(direction()).toBe('column');
  expect(screen.getByTestId('saved-recordings-selection-summary')).toBeTruthy();

  await act(async () => {
    Dimensions.set({
      window: viewport(900, 1.4),
      screen: viewport(900, 1.4),
    });
    await fireEvent(sensor, 'geometryChange', {
      nativeEvent: geometry(900, false),
    });
  });
  expect(direction()).toBe('column');
  expect(screen.getByTestId('saved-recordings-selection-summary')).toBeTruthy();

  await act(async () => {
    Dimensions.set({ window: viewport(320), screen: viewport(320) });
    await fireEvent(sensor, 'geometryChange', {
      nativeEvent: geometry(320, false),
    });
  });
  expect(direction()).toBe('column');
  expect(
    StyleSheet.flatten(
      screen.getByTestId('saved-recordings-layout-primary').props.style,
    )?.width,
  ).toBe(320);

  const alert = mockNativeDeletionAlert();
  await fireEvent.press(
    screen.getByTestId('recording-delete-recording-source'),
  );
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
  await act(async () => confirmNativeDeletion(alert));
  await waitFor(() => {
    expect(
      screen.queryByTestId('saved-recordings-selection-summary'),
    ).toBeNull();
  });
  await act(async () => {
    Dimensions.set({ window: viewport(900), screen: viewport(900) });
    await fireEvent(sensor, 'geometryChange', {
      nativeEvent: geometry(900, true),
    });
  });
  expect(direction()).toBe('column');
  expect(columnWidth('primary')).toBeLessThanOrEqual(leftUsableRegionWidth);
  expect(service.deleteRecording).toHaveBeenCalledWith(source.id);
  alert.mockRestore();
});
