import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { Dimensions, StyleSheet, View } from 'react-native';
import App from '../../../App';
import type { HealthReviewService } from '../service';
import type { NavigationGeometryPayload } from '../../navigation/navigationGeometry';
import { appContentLayoutOwner } from '../../navigation/appContentLayoutPolicy';

jest.mock('../../healthkit/commonObservations/importLocal', () => ({
  importLocalCommonObservations: jest.fn(),
}));
jest.mock('../../healthkit/bloodPressure/importLocal', () => ({
  importLocalBloodPressure: jest.fn(),
  listLocalBloodPressureObservations: jest.fn(),
}));
jest.mock('../../backup/backupSupport', () => ({
  prepareBackupSupport: jest.fn(async () => 'ready'),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

const originalWindow = Dimensions.get('window');
const originalScreen = Dimensions.get('screen');
const viewport = (width: number, fontScale = 1) => ({
  ...originalWindow,
  width,
  height: 700,
  scale: 1,
  fontScale,
});
const hostBounds = new Map<
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

jest
  .spyOn(measurableView.prototype, 'measureInWindow')
  .mockImplementation(function (
    this: { readonly props: { readonly testID?: string } },
    callback,
  ) {
    const bounds = hostBounds.get(this.props.testID ?? '');
    if (bounds) callback(bounds.x, 0, bounds.width, 600);
  });

beforeEach(() => {
  hostBounds.clear();
  Dimensions.set({ window: viewport(900), screen: viewport(900) });
});

afterEach(() => {
  Dimensions.set({ window: originalWindow, screen: originalScreen });
});

function geometry(
  width: number,
  divisionX?: number,
): NavigationGeometryPayload {
  return {
    windowBounds: { x: 0, y: 0, width, height: 700 },
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    reservedRegionsSupported: divisionX !== undefined,
    reservedRegions:
      divisionX === undefined
        ? []
        : [
            {
              id: 'duo-division',
              kind: 'division',
              frame: { x: divisionX, y: 0, width: 10, height: 700 },
              margins: { top: 0, right: 0, bottom: 0, left: 0 },
              isActive: true,
            },
          ],
  };
}

it('keeps the four AI actions and reaches a separate App review route with a retained draft', async () => {
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
  const service: HealthReviewService = {
    list: jest.fn(async () => []),
    start: jest.fn(),
    continue: jest.fn(),
    delete: jest.fn(),
  };
  await render(<App healthReviewService={service} />);
  await fireEvent.press(screen.getByTestId('navigation-tab-ai'));
  for (const id of [
    'visit-questions',
    'disease-hypotheses',
    'rag-conversation',
    'external-evidence',
    'health-review',
  ])
    expect(screen.getByTestId('ai-feature-' + id)).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('ai-feature-health-review'));
  expect(await screen.findByTestId('health-review-screen')).toBeOnTheScreen();
  const healthReviewRoute = { key: 'health-review', name: 'health-review' };
  expect(
    typeof appContentLayoutOwner === 'function'
      ? appContentLayoutOwner(healthReviewRoute)
      : appContentLayoutOwner,
  ).toBe('screen');
  expect(screen.queryAllByTestId(/navigation-route-columns-/)).toHaveLength(0);

  const direction = () =>
    StyleSheet.flatten(
      screen.getByTestId('health-review-population-choices').props.style,
    ).flexDirection;
  await fireEvent(screen.getByTestId('health-review-form'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 852, height: 700 } },
  });
  expect(direction()).toBe('row');
  hostBounds.set('health-review-layout-host', { x: 24, width: 852 });
  await fireEvent(
    screen.getByTestId('navigation-window-geometry-sensor'),
    'geometryChange',
    { nativeEvent: geometry(900, 445) },
  );
  await fireEvent(screen.getByTestId('health-review-form'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 421, height: 700 } },
  });
  expect(direction()).toBe('column');
  // Route copy must stay inside its measured lane when native geometry reserves
  // a division.
  expect(
    within(screen.getByTestId('health-review-layout')).getByTestId(
      'health-review-heading',
    ),
  ).toBeOnTheScreen();

  await fireEvent.changeText(
    screen.getByTestId('health-review-name'),
    '유지할 요청',
  );

  await act(async () => {
    Dimensions.set({ window: viewport(500), screen: viewport(500) });
    hostBounds.set('health-review-layout-host', { x: 24, width: 452 });
    await fireEvent(
      screen.getByTestId('navigation-window-geometry-sensor'),
      'geometryChange',
      { nativeEvent: geometry(500) },
    );
  });
  await fireEvent(screen.getByTestId('health-review-form'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 452, height: 700 } },
  });
  expect(direction()).toBe('column');
  expect(
    within(screen.getByTestId('health-review-layout')).getByTestId(
      'health-review-heading',
    ),
  ).toBeOnTheScreen();
  expect(screen.getByTestId('health-review-name')).toHaveDisplayValue(
    '유지할 요청',
  );
  expect(service.start).not.toHaveBeenCalled();
  expect(service.continue).not.toHaveBeenCalled();

  await act(async () => {
    Dimensions.set({ window: viewport(900, 2), screen: viewport(900, 2) });
    hostBounds.set('health-review-layout-host', { x: 24, width: 852 });
    await fireEvent(
      screen.getByTestId('navigation-window-geometry-sensor'),
      'geometryChange',
      { nativeEvent: geometry(900) },
    );
  });
  await fireEvent(screen.getByTestId('health-review-form'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 852, height: 700 } },
  });
  expect(direction()).toBe('column');
  expect(
    within(screen.getByTestId('health-review-layout')).getByTestId(
      'health-review-heading',
    ),
  ).toBeOnTheScreen();
  expect(service.start).not.toHaveBeenCalled();
  expect(service.continue).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId('navigation-back'));
  await fireEvent.press(screen.getByTestId('ai-feature-health-review'));
  expect(screen.getByTestId('health-review-name')).toHaveDisplayValue(
    '유지할 요청',
  );
  expect(service.start).not.toHaveBeenCalled();
  expect(service.continue).not.toHaveBeenCalled();
});
