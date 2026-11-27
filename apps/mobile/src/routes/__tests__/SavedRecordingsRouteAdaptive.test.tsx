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
  requestLibraryRowDeletion,
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

test('keeps a single bounded recording list as native route geometry changes', async () => {
  const controller = createNavigationController<AppNavigationRoute>('root');
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
  const columnWidth = () =>
    StyleSheet.flatten(
      screen.getByTestId('saved-recordings-layout-frame-primary').props.style,
    )?.width;
  await fireEvent(sensor, 'geometryChange', {
    nativeEvent: geometry(900, true),
  });
  expect(direction()).toBe('column');
  expect(columnWidth()).toBeLessThanOrEqual(leftUsableRegionWidth);
  await fireEvent.press(
    screen.getByTestId('recording-details-recording-source'),
  );

  expect(screen.getByTestId('recording-review-back')).toBeTruthy();
  const updatedTitle = 'Exact saved AI title (synthetic)';
  service.replaceSavedTitle(updatedTitle);
  const reviewRouteKey = controller.getSnapshot().currentRoute.key;
  // RecordingReviewRoute measures the shared usable lane for both recording and review panels.
  expect(
    screen.getByTestId(`navigation-route-scene-${reviewRouteKey}`),
  ).toBeTruthy();
  expect(
    screen.queryByTestId(`navigation-route-columns-${reviewRouteKey}`),
  ).toBeNull();
  await fireEvent.press(screen.getByTestId('recording-review-back'));
  await waitFor(() => {
    expect(controller.getSnapshot().currentRoute.key).toBe(savedRouteKey);
  });

  await screen.findByText(updatedTitle);
  const row = screen.getByTestId('recording-library-item-recording-source');
  expect(row).toHaveTextContent(/Exact saved AI title \(synthetic\)/u);
  expect(screen.queryByText(source.title!)).toBeNull();
  expect(
    screen.getByTestId('recording-details-recording-source').props
      .accessibilityLabel,
  ).toContain(updatedTitle);
  expect(row).toHaveTextContent(/01:33/u);
  expect(row).not.toHaveTextContent(/저장된 전사/u);
  const lane = StyleSheet.flatten(
    screen.getByTestId('recording-library-lane').props.style,
  );
  expect(lane).toMatchObject({ width: '100%', maxWidth: 440, minWidth: 0 });
  expect(screen.queryByTestId('saved-recordings-selection-summary')).toBeNull();
  await fireEvent(sensor, 'geometryChange', {
    nativeEvent: geometry(900, true),
  });
  expect(direction()).toBe('column');
  expect(columnWidth()).toBeLessThanOrEqual(leftUsableRegionWidth);
  expect(
    screen.getByTestId('recording-library-item-recording-source'),
  ).toBeTruthy();
  expect(screen.queryByTestId('saved-recordings-selection-summary')).toBeNull();

  await act(async () => {
    Dimensions.set({ window: viewport(500), screen: viewport(500) });
    await fireEvent(sensor, 'geometryChange', {
      nativeEvent: geometry(500, false),
    });
  });
  expect(direction()).toBe('column');
  expect(
    screen.getByTestId('recording-library-item-recording-source'),
  ).toBeTruthy();
  expect(screen.queryByTestId('saved-recordings-selection-summary')).toBeNull();

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
  expect(
    screen.getByTestId('recording-library-item-recording-source'),
  ).toBeTruthy();
  expect(screen.queryByTestId('saved-recordings-selection-summary')).toBeNull();

  await act(async () => {
    Dimensions.set({ window: viewport(320), screen: viewport(320) });
    await fireEvent(sensor, 'geometryChange', {
      nativeEvent: geometry(320, false),
    });
  });
  expect(direction()).toBe('column');
  expect(
    StyleSheet.flatten(
      screen.getByTestId('saved-recordings-layout-frame-primary').props.style,
    )?.width,
  ).toBe(320);

  expect(service.listSummaries).toHaveBeenCalledTimes(2);
  const alert = mockNativeDeletionAlert();
  await requestLibraryRowDeletion('recording-source');
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
  await act(async () => confirmNativeDeletion(alert));
  await waitFor(() => {
    expect(
      screen.queryByTestId('recording-library-item-recording-source'),
    ).toBeNull();
  });
  await act(async () => {
    Dimensions.set({ window: viewport(900), screen: viewport(900) });
    await fireEvent(sensor, 'geometryChange', {
      nativeEvent: geometry(900, true),
    });
  });
  expect(direction()).toBe('column');
  expect(columnWidth()).toBeLessThanOrEqual(leftUsableRegionWidth);
  expect(service.deleteRecording).toHaveBeenCalledWith(source.id);
  alert.mockRestore();
});
