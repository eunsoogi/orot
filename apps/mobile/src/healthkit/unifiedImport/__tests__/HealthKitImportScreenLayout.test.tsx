import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';
import { NavigationGeometryProvider } from '../../../navigation/NavigationGeometryProvider';
import type { NavigationGeometryPayload } from '../../../navigation/navigationGeometry';
import { createUnifiedImportCoordinator } from '../coordinator';
import { HealthKitImportScreen } from '../HealthKitImportScreen';
import { unifiedHealthImportCopy } from '../copy';
import { createTestServices, deferred } from '../testSupport';

const measurableView = View as unknown as {
  prototype: {
    measureInWindow: (
      callback: (x: number, y: number, width: number, height: number) => void,
    ) => void;
  };
};
const windowBounds = new Map<
  string,
  { readonly x: number; readonly width: number }
>();
const noInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const duoGeometry: NavigationGeometryPayload = {
  windowBounds: { x: 0, y: 0, width: 1700, height: 900 },
  safeAreaInsets: noInsets,
  reservedRegionsSupported: true,
  reservedRegions: [
    {
      id: 'display-division',
      kind: 'division',
      frame: { x: 820, y: 0, width: 40, height: 900 },
      margins: noInsets,
      isActive: true,
    },
  ],
};

beforeEach(() => windowBounds.clear());

const measureSpy = jest
  .spyOn(measurableView.prototype, 'measureInWindow')
  .mockImplementation(function (
    this: { readonly props: { readonly testID?: string } },
    callback,
  ) {
    const bounds = windowBounds.get(this.props.testID ?? '');
    if (bounds) callback(bounds.x, 0, bounds.width, 600);
  });

afterAll(() => measureSpy.mockRestore());

function remeasure(width: number, x = 0) {
  windowBounds.set('unified-import-columns-host', { x, width });
  return fireEvent(
    screen.getByTestId('unified-import-columns-host'),
    'layout',
    {
      nativeEvent: { layout: { x: 0, y: 0, width, height: 600 } },
    },
  );
}

function axis() {
  return StyleSheet.flatten(
    screen.getByTestId('unified-import-columns').props.style,
  )?.flexDirection;
}

test('keeps source scope and live import progress in separate mounted panels during reflow', async () => {
  const query = deferred<void>();
  const services = createTestServices({
    async runFeature(_feature, _authorization, _repository, instrumentation) {
      await instrumentation.query(async () => query.promise);
      return { status: 'complete', importedCount: 1, deletedCount: 0 };
    },
  });
  const baseCoordinator = createUnifiedImportCoordinator(services.services);
  const start = jest.fn(baseCoordinator.start);
  await render(
    <HealthKitImportScreen
      copy={unifiedHealthImportCopy}
      coordinator={{ start }}
    />,
  );

  const sourcePanel = screen.getByTestId('unified-import-source-selection');
  const activityPanel = screen.getByTestId('unified-import-activity');
  expect(
    within(sourcePanel).getByTestId('unified-import-toggle-heartRate'),
  ).toBeTruthy();
  expect(
    within(activityPanel).queryByTestId(
      'unified-import-feature-status-heartRate',
    ),
  ).toBeNull();
  await fireEvent.press(
    within(sourcePanel).getByTestId('unified-import-toggle-heartRate'),
  );
  await fireEvent.press(screen.getByTestId('unified-import-start'));

  const featureStatus = await within(activityPanel).findByTestId(
    'unified-import-feature-status-heartRate',
  );
  await waitFor(() =>
    expect(featureStatus).toHaveTextContent(
      unifiedHealthImportCopy.featureStatuses.querying,
    ),
  );
  expect(
    within(sourcePanel).queryByTestId(
      'unified-import-feature-status-heartRate',
    ),
  ).toBeNull();

  await remeasure(1500);
  expect(axis()).toBe('row');
  expect(
    within(sourcePanel).getByTestId('unified-import-toggle-heartRate').props
      .accessibilityState.checked,
  ).toBe(true);
  expect(featureStatus).toHaveTextContent(
    unifiedHealthImportCopy.featureStatuses.querying,
  );
  await remeasure(1200);
  expect(axis()).toBe('column');
  await remeasure(900);
  expect(axis()).toBe('column');
  expect(featureStatus).toHaveTextContent(
    unifiedHealthImportCopy.featureStatuses.querying,
  );
  expect(start).toHaveBeenCalledTimes(1);

  await act(async () => {
    query.resolve();
    await query.promise;
  });
  await waitFor(() =>
    expect(featureStatus).toHaveTextContent(
      unifiedHealthImportCopy.featureStatuses.complete,
    ),
  );
  expect(start).toHaveBeenCalledTimes(1);
});

test('reflows Duo regions and falls back for narrow hosts', async () => {
  const query = deferred<void>();
  const services = createTestServices({
    async runFeature(_feature, _authorization, _repository, instrumentation) {
      await instrumentation.query(async () => query.promise);
      return { status: 'complete', importedCount: 1, deletedCount: 0 };
    },
  });
  const baseCoordinator = createUnifiedImportCoordinator(services.services);
  const start = jest.fn(baseCoordinator.start);
  const onBack = jest.fn();
  await render(
    <NavigationGeometryProvider>
      <HealthKitImportScreen
        copy={unifiedHealthImportCopy}
        coordinator={{ start }}
        onBack={onBack}
      />
    </NavigationGeometryProvider>,
  );

  const primaryRegion = screen.getByTestId('unified-import-columns-primary');
  const secondaryRegion = screen.getByTestId(
    'unified-import-columns-secondary',
  );
  const primaryContent = within(primaryRegion);
  const activityContent = within(secondaryRegion);
  const sourcePanel = screen.getByTestId('unified-import-source-selection');
  const activityPanel = screen.getByTestId('unified-import-activity');
  expect(
    primaryContent.getAllByTestId(/unified-import-(title|description)/),
  ).toHaveLength(2);
  expect(
    primaryContent.getByTestId('healthkit-unified-import-back'),
  ).toBeTruthy();
  expect(activityContent.getByTestId('unified-import-start')).toBeTruthy();
  await fireEvent.press(
    within(sourcePanel).getByTestId('unified-import-toggle-heartRate'),
  );
  await fireEvent.press(activityContent.getByTestId('unified-import-start'));
  expect(activityContent.getByTestId('unified-import-cancel')).toBeTruthy();
  const featureStatus = await within(activityPanel).findByTestId(
    'unified-import-feature-status-heartRate',
  );
  await waitFor(() =>
    expect(featureStatus).toHaveTextContent(
      unifiedHealthImportCopy.featureStatuses.querying,
    ),
  );

  await fireEvent(
    screen.getByTestId('navigation-window-geometry-sensor'),
    'geometryChange',
    { nativeEvent: duoGeometry },
  );
  await remeasure(1700);
  expect(axis()).toBe('row');
  expect(activityContent.getByTestId('unified-import-cancel')).toBeTruthy();
  expect(
    StyleSheet.flatten(
      screen.getByTestId('unified-import-columns-primary').props.style,
    )?.width,
  ).toBeGreaterThan(0);
  expect(
    StyleSheet.flatten(
      screen.getByTestId('unified-import-columns-secondary').props.style,
    )?.width,
  ).toBeGreaterThan(0);
  expect(featureStatus).toHaveTextContent(
    unifiedHealthImportCopy.featureStatuses.querying,
  );

  // Check a narrow host in each usable region without crossing the display division.
  for (const x of [0, 860]) {
    await remeasure(700, x);
    expect(axis()).toBe('column');
    expect(
      within(sourcePanel).getByTestId('unified-import-toggle-heartRate').props
        .accessibilityState.checked,
    ).toBe(true);
    expect(featureStatus).toHaveTextContent(
      unifiedHealthImportCopy.featureStatuses.querying,
    );
    expect(start).toHaveBeenCalledTimes(1);
  }

  await act(async () => {
    query.resolve();
    await query.promise;
  });
  await waitFor(() =>
    expect(featureStatus).toHaveTextContent(
      unifiedHealthImportCopy.featureStatuses.complete,
    ),
  );
});
