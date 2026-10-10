import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Text } from 'react-native';
import { NavigationRouteAdapter } from '../../../navigation/NavigationRouteAdapter';
import { createNavigationController } from '../../../navigation/navigationController';
import { confirmNavigationLeave } from '../../../navigation/navigationLeaveConfirmation';
import { healthKitFeatures } from '../../types';
import { HealthKitImportScreen } from '../HealthKitImportScreen';
import { unifiedHealthImportCopy } from '../copy';
import { createUnifiedImportCoordinator } from '../coordinator';
import type { UnifiedImportRun } from '../types';
import { createTestServices, deferred } from '../testSupport';

jest.mock('../../../navigation/navigationLeaveConfirmation', () => ({
  confirmNavigationLeave: jest.fn(async () => true),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

test('keeps the run when leaving is declined and cancels only after confirmed shared navigation', async () => {
  const base = createTestServices();
  const permission =
    deferred<
      Awaited<
        ReturnType<typeof base.services.healthKit.requestReadAuthorizations>
      >
    >();
  const authorize = jest.fn(() => permission.promise);
  const runFeature = jest.fn(base.services.runFeature);
  const coordinator = createUnifiedImportCoordinator({
    ...base.services,
    healthKit: { requestReadAuthorizations: authorize },
    runFeature,
  });
  let activeRun: UnifiedImportRun | undefined;
  const screenCoordinator = {
    start: (...args: Parameters<typeof coordinator.start>) => {
      activeRun = coordinator.start(...args);
      return activeRun;
    },
  };
  const controller = createNavigationController<'records' | 'import'>(
    'records',
  );
  controller.push('import');
  await render(
    <NavigationRouteAdapter controller={controller} showHome>
      {actions =>
        actions.route.name === 'import' ? (
          <HealthKitImportScreen
            copy={unifiedHealthImportCopy}
            coordinator={screenCoordinator}
          />
        ) : (
          <Text testID="records-home">기록</Text>
        )
      }
    </NavigationRouteAdapter>,
  );

  expect(screen.getByTestId('unified-import-start')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('unified-import-toggle-healthKit'));
  for (const feature of healthKitFeatures) {
    expect(
      screen.getByTestId(`unified-import-toggle-${feature}`).props
        .accessibilityState.checked,
    ).toBe(true);
  }
  expect(authorize).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('unified-import-start'));
  await waitFor(() => expect(authorize).toHaveBeenCalledTimes(1));
  expect(screen.getByTestId('unified-import-cancel')).toBeTruthy();
  expect(authorize).toHaveBeenCalledWith(healthKitFeatures);

  jest.mocked(confirmNavigationLeave).mockResolvedValueOnce(false);
  await fireEvent.press(screen.getByTestId('navigation-back'));
  expect(screen.getByTestId('unified-import-scroll')).toBeTruthy();
  expect(runFeature).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  await waitFor(() => expect(screen.getByTestId('records-home')).toBeTruthy());
  permission.resolve(
    await base.services.healthKit.requestReadAuthorizations(healthKitFeatures),
  );
  expect(activeRun).toBeDefined();
  await expect(activeRun?.result).resolves.toMatchObject({
    status: 'cancelled',
  });
  expect(confirmNavigationLeave).toHaveBeenCalledTimes(2);
  expect(runFeature).not.toHaveBeenCalled();
});

test.each(['navigation-back', 'navigation-home'])(
  'blocks %s while a selected calendar candidate is saving and releases it after completion',
  async navigationID => {
    // Hold the actual coordinator persistence boundary while using the production navigation shell.
    const save = deferred<void>();
    const confirmCalendarEvent = jest.fn(() => save.promise);
    const base = createTestServices({ confirmCalendarEvent });
    const controller = createNavigationController<'records' | 'import'>(
      'records',
    );
    controller.push('import');
    await render(
      <NavigationRouteAdapter controller={controller} showHome>
        {actions =>
          actions.route.name === 'import' ? (
            <HealthKitImportScreen
              copy={unifiedHealthImportCopy}
              coordinator={createUnifiedImportCoordinator(base.services)}
            />
          ) : (
            <Text testID="records-home">기록</Text>
          )
        }
      </NavigationRouteAdapter>,
    );
    await fireEvent.press(screen.getByTestId('unified-import-toggle-eventKit'));
    await fireEvent.press(screen.getByTestId('unified-import-start'));
    await screen.findByTestId('unified-import-eventkit-select-0');
    await fireEvent.press(
      screen.getByTestId('unified-import-eventkit-select-0'),
    );
    await fireEvent.press(
      screen.getByTestId('unified-import-eventkit-confirm'),
    );
    await waitFor(() => expect(confirmCalendarEvent).toHaveBeenCalledTimes(1));
    expect(
      screen.getByTestId('unified-import-eventkit-confirm'),
    ).toBeDisabled();
    expect(screen.getByTestId('navigation-back')).toBeDisabled();
    expect(screen.getByTestId('navigation-home')).toBeDisabled();
    const confirmationsBefore = jest.mocked(confirmNavigationLeave).mock.calls
      .length;
    await fireEvent.press(screen.getByTestId(navigationID));
    expect(screen.getByTestId('unified-import-scroll')).toBeTruthy();
    expect(screen.queryByTestId('records-home')).toBeNull();
    expect(confirmNavigationLeave).toHaveBeenCalledTimes(confirmationsBefore);
    await act(async () => save.resolve());
    await screen.findByTestId('unified-import-eventkit-confirmed');
    expect(screen.getByTestId('navigation-back')).toBeEnabled();
    expect(screen.getByTestId('navigation-home')).toBeEnabled();
    await fireEvent.press(screen.getByTestId(navigationID));
    await screen.findByTestId('records-home');
    expect(confirmCalendarEvent).toHaveBeenCalledTimes(1);
  },
);
