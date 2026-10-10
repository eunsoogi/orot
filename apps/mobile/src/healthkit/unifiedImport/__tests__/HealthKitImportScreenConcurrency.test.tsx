import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { healthKitFeatures } from '../../types';
import { createUnifiedImportCoordinator } from '../coordinator';
import type {
  HealthKitImportScreenCopy,
  UnifiedImportCoordinator,
} from '../HealthKitImportScreen';
import { HealthKitImportScreen } from '../HealthKitImportScreen';
import { createTestServices, deferred } from '../testSupport';
import type { UnifiedImportMeasurement, UnifiedImportRun } from '../types';

const copy: HealthKitImportScreenCopy = {
  title: '가져오기',
  description: '항목 선택',
  localOnly: '이 기기에 저장',
  readAuthorization: '읽기 권한 상태는 확인할 수 없어요.',
  importButton: '가져오기',
  cancelButton: '취소',
  featureNames: Object.fromEntries(
    healthKitFeatures.map(feature => [feature, feature]),
  ) as HealthKitImportScreenCopy['featureNames'],
  featureStatuses: {} as HealthKitImportScreenCopy['featureStatuses'],
  phaseStatuses: {
    queued: 'queued',
    authorizingEventKit: 'authorizingEventKit',
    queryingEventKit: 'queryingEventKit',
    complete: 'complete',
  } as HealthKitImportScreenCopy['phaseStatuses'],
  changeSummary: () => '',
};

test('late confirmation progress cannot replace a newer run status', async () => {
  const base = createTestServices();
  const secondQuery =
    deferred<
      Awaited<ReturnType<typeof base.services.eventKit.listUpcomingEvents>>
    >();
  const confirmation = deferred<void>();
  const confirmCalendarEvent = jest.fn(() => confirmation.promise);
  let queryCount = 0;
  const coordinator = createUnifiedImportCoordinator({
    ...base.services,
    eventKit: {
      requestEventAccess: base.services.eventKit.requestEventAccess,
      listUpcomingEvents: jest.fn(() => {
        queryCount += 1;
        return queryCount === 1
          ? base.services.eventKit.listUpcomingEvents()
          : secondQuery.promise;
      }),
    },
    confirmCalendarEvent,
  });
  const runs: UnifiedImportRun[] = [];
  const screenCoordinator: UnifiedImportCoordinator = {
    start: (selection, listeners) => {
      const run = coordinator.start(selection, listeners);
      runs.push(run);
      return run;
    },
  };
  await render(
    <HealthKitImportScreen copy={copy} coordinator={screenCoordinator} />,
  );

  await fireEvent.press(screen.getByTestId('unified-import-toggle-eventKit'));
  await fireEvent.press(screen.getByTestId('unified-import-start'));
  expect(
    await screen.findByTestId('unified-import-eventkit-candidate-0'),
  ).toBeTruthy();
  await fireEvent.press(screen.getByTestId('unified-import-eventkit-select-0'));
  const oldConfirmation = runs[0].confirmCalendarEvent(base.calendarEvent);
  expect(confirmCalendarEvent).toHaveBeenCalledTimes(1);

  await fireEvent.press(screen.getByTestId('unified-import-start'));
  await waitFor(() =>
    expect(screen.getByTestId('unified-import-status')).toHaveTextContent(
      'queryingEventKit',
    ),
  );
  expect(runs).toHaveLength(2);

  await act(async () => {
    confirmation.resolve();
    await oldConfirmation;
  });
  await waitFor(() =>
    expect(screen.getByTestId('unified-import-status')).toHaveTextContent(
      'queryingEventKit',
    ),
  );
  expect(screen.queryByTestId('unified-import-eventkit-confirmed')).toBeNull();

  await act(async () => {
    secondQuery.resolve({ access: 'fullAccess', events: [base.calendarEvent] });
    await runs[1].result;
  });
});

test('late save measurements stay with the import run that started them', async () => {
  const base = createTestServices();
  const secondQuery =
    deferred<
      Awaited<ReturnType<typeof base.services.eventKit.listUpcomingEvents>>
    >();
  const confirmations = [deferred<void>(), deferred<void>()];
  let confirmationIndex = 0;
  const confirmCalendarEvent = jest.fn(
    () => confirmations[confirmationIndex++].promise,
  );
  let queryCount = 0;
  const coordinator = createUnifiedImportCoordinator({
    ...base.services,
    eventKit: {
      requestEventAccess: base.services.eventKit.requestEventAccess,
      listUpcomingEvents: jest.fn(() => {
        queryCount += 1;
        return queryCount === 1
          ? base.services.eventKit.listUpcomingEvents()
          : secondQuery.promise;
      }),
    },
    confirmCalendarEvent,
  });
  const runs: UnifiedImportRun[] = [];
  const measurements: UnifiedImportMeasurement[] = [];
  const screenCoordinator: UnifiedImportCoordinator = {
    start: (selection, listeners) => {
      const run = coordinator.start(selection, listeners);
      runs.push(run);
      return run;
    },
  };
  await render(
    <HealthKitImportScreen
      copy={copy}
      coordinator={screenCoordinator}
      onMeasurement={measurement => measurements.push(measurement)}
      onRunStarted={() => {
        measurements.length = 0;
      }}
    />,
  );

  await fireEvent.press(screen.getByTestId('unified-import-toggle-eventKit'));
  await fireEvent.press(screen.getByTestId('unified-import-start'));
  expect(
    await screen.findByTestId('unified-import-eventkit-candidate-0'),
  ).toBeTruthy();
  await fireEvent.press(screen.getByTestId('unified-import-eventkit-select-0'));
  const oldConfirmation = runs[0].confirmCalendarEvent(base.calendarEvent);

  await fireEvent.press(screen.getByTestId('unified-import-start'));
  await waitFor(() =>
    expect(screen.getByTestId('unified-import-status')).toHaveTextContent(
      'queryingEventKit',
    ),
  );
  await act(async () => {
    secondQuery.resolve({ access: 'fullAccess', events: [base.calendarEvent] });
    await runs[1].result;
  });
  await fireEvent.press(screen.getByTestId('unified-import-eventkit-select-0'));
  const currentConfirmation = runs[1].confirmCalendarEvent(base.calendarEvent);
  expect(measurements).toContainEqual(
    expect.objectContaining({
      provider: 'localStore',
      sourceProvider: 'eventKit',
      phase: 'persistence',
      transition: 'started',
    }),
  );

  await act(async () => {
    confirmations[0].resolve();
    await oldConfirmation;
  });
  expect(
    measurements.filter(
      measurement =>
        measurement.sourceProvider === 'eventKit' &&
        measurement.phase === 'persistence' &&
        measurement.transition === 'finished',
    ),
  ).toHaveLength(0);

  await act(async () => {
    confirmations[1].resolve();
    await currentConfirmation;
  });
  expect(
    measurements.filter(
      measurement =>
        measurement.sourceProvider === 'eventKit' &&
        measurement.phase === 'persistence' &&
        measurement.transition === 'finished',
    ),
  ).toHaveLength(1);
});
