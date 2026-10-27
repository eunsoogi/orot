import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';
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

function remeasure(width: number) {
  windowBounds.set('unified-import-columns-host', { x: 0, width });
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
