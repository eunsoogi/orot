import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../healthEvidence/localEvidenceTestSupport';
import { NavigationRouteAdapter } from '../../navigation/NavigationRouteAdapter';
import {
  appContentLayoutOwner,
  appRouteIsScrollable,
} from '../../navigation/appContentLayoutPolicy';
import { createNavigationController } from '../../navigation/navigationController';
import { openLocalStorage } from '../../storage/secureDatabase';
import {
  AppOverviewDataBoundary,
  AppOverviewDataRouteContent,
} from '../AppOverviewDataBoundary';
import { RecordSourceNavigationProvider } from '../RecordSourceNavigation';
import type { AppNavigationRoute } from '../appNavigationRoute';
import { loadOverviewMetrics } from '../overview/metricLoader';
import { loadOverviewMetricSelection } from '../overview/metricSelection';
import { recentRouteProps } from '../testSupport/recentRecordsRouteTestSupport';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('react-native-chart-kit/v2', () => ({
  ChartKitProvider: ({ children }: { children: React.ReactNode }) => children,
  LineChart: () => null,
  BarChart: () => null,
}));
jest.mock('../../storage/secureDatabase', () => ({
  openLocalStorage: jest.fn(),
  openLocalAgentMemoryDatabase: jest.fn(async () => ({})),
}));
jest.mock('../overview/metricLoader', () => ({
  loadOverviewMetrics: jest.fn(async () => ({
    metrics: {},
    quantityTruncated: false,
  })),
}));
// The real overview/navigation/SQLite preference flow is mounted. Other
// app destinations are never opened by this integration and load no services.
jest.mock('../OverviewPreparedVisits', () => ({
  OverviewPreparedVisits: () => null,
}));
jest.mock('../AppointmentQuestionRoutes', () => ({
  AppointmentQuestionRoutes: () => null,
}));
jest.mock('../RecordsMaterialDestination', () => ({
  RecordsMaterialDestination: () => null,
}));
jest.mock('../HealthRecordsRoute', () => ({ HealthRecordsRoute: () => null }));
jest.mock('../SettingsDetailsRoute', () => ({
  SettingsDetailsRoute: () => null,
}));
jest.mock('../SettingsRoute', () => ({ SettingsRoute: () => null }));
jest.mock('../RecordsRoute', () => ({ RecordsRoute: () => null }));
jest.mock('../ScheduleRoute', () => ({ ScheduleRoute: () => null }));
jest.mock('../MedicalDocumentDetailRoute', () => ({
  MedicalDocumentDetailRoute: () => null,
}));
jest.mock('../RecordingReviewRoute', () => ({
  RecordingReviewRoute: () => null,
}));
jest.mock('../SavedRecordingsRoute', () => ({
  SavedRecordingsRoute: () => null,
}));
jest.mock('../../recording/RecordingScreen', () => () => null);
jest.mock('../../healthkit/unifiedImport/UnifiedImportRoute', () => ({
  UnifiedImportRoute: () => null,
}));
jest.mock('../../appointments/AppointmentsScreen', () => () => null);
jest.mock('../../memory/SavedMemoryDetail', () => ({
  SavedMemoryDetail: () => null,
}));
jest.mock('../useAppOverviewData', () => ({
  useAppOverviewData: () => ({
    appointmentRepository: null,
    appointmentState: 'ready',
    nextAppointment: null,
    recordings: [],
    recordingState: 'ready',
    refreshAppointments: async () => {},
    refreshRecordings: async () => {},
  }),
}));

const initial = ['sleep', 'heartRate'];
const added = ['workouts', 'steps', 'bodyMass'];
async function mountOverview(
  repository: ReturnType<typeof createRecordRepository>,
) {
  jest.mocked(openLocalStorage).mockResolvedValue(repository);
  jest.mocked(loadOverviewMetrics).mockClear();
  const controller = createNavigationController<AppNavigationRoute>('root');
  const props = { ...recentRouteProps(), activeTab: 'overview' as const };
  const mounted = await render(
    <AppOverviewDataBoundary
      activeTab="overview"
      controller={controller}
      loadAppointments={async () => {
        throw new Error('Synthetic fixture is already ready');
      }}
      loadRecordings={async () => []}
    >
      <RecordSourceNavigationProvider>
        <NavigationRouteAdapter
          controller={controller}
          contentLayoutOwner={appContentLayoutOwner}
          scrollable={route => appRouteIsScrollable(route, 'overview')}
          rootTabs={route =>
            route.name === 'root'
              ? { activeTab: 'overview', onSelect: props.selectTab }
              : undefined
          }
        >
          {actions => (
            <AppOverviewDataRouteContent {...props} actions={actions} />
          )}
        </NavigationRouteAdapter>
      </RecordSourceNavigationProvider>
    </AppOverviewDataBoundary>,
  );
  const openEditor = async () => {
    const edit = await screen.findByTestId('overview-metrics-edit');
    await waitFor(() => expect(edit).toBeEnabled());
    await fireEvent.press(edit);
    expect(controller.getSnapshot().currentRoute.name).toBe(
      'overview-metric-selection',
    );
    expect(
      await screen.findByTestId('overview-metric-selection-screen'),
    ).toBeTruthy();
    expect(await screen.findByText('지표를 2개 이상 선택하세요.')).toBeTruthy();
    expect(screen.queryByTestId('overview-metric-grid')).toBeNull();
    expect(screen.getAllByTestId('navigation-route-scroll')).toHaveLength(1);
  };
  return { controller, mounted, openEditor };
}
const choice = (metric: string) =>
  screen.getByTestId('overview-metric-selection-' + metric);
const save = () => screen.getByTestId('overview-metric-selection-save');
const cancel = () => screen.getByTestId('overview-metric-selection-cancel');

test('separate editor discards Cancel and saves all five ordered cards into the real local checkpoint', async () => {
  const f = createHealthEvidenceTestDatabase();
  await runMigrations(f.database);
  const records = createRecordRepository(f.database);
  const { controller, mounted, openEditor } = await mountOverview(records);
  try {
    expect(screen.queryByRole('checkbox')).toBeNull();
    const metricLoads = jest.mocked(loadOverviewMetrics).mock.calls.length;
    await openEditor();
    expect(loadOverviewMetrics).toHaveBeenCalledTimes(metricLoads);
    await fireEvent.press(choice('sleep'));
    expect(save()).toBeDisabled();
    await fireEvent.press(choice('bodyMass'));
    expect(save()).toBeEnabled();
    await fireEvent.press(cancel());
    await screen.findByTestId('overview-metric-grid');
    expect(controller.getSnapshot().currentRoute.name).toBe('root');
    expect(await loadOverviewMetricSelection(records)).toEqual(initial);

    await openEditor();
    expect(choice('sleep').props.accessibilityState.checked).toBe(true);
    expect(choice('bodyMass').props.accessibilityState.checked).toBe(false);
    for (const metric of added) await fireEvent.press(choice(metric));
    expect(screen.getAllByRole('checkbox')).toHaveLength(5);
    expect(save()).toBeEnabled();
    await fireEvent.press(save());
    await screen.findByTestId('overview-metric-workouts');
    expect(controller.getSnapshot().currentRoute.name).toBe('root');
    expect(
      screen
        .getAllByTestId(
          /^overview-metric-(sleep|heartRate|workouts|steps|bodyMass)$/,
        )
        .map(node => node.props.testID),
    ).toEqual(
      [...initial, ...added].map(metric => 'overview-metric-' + metric),
    );
    expect(await loadOverviewMetricSelection(records)).toEqual([
      ...initial,
      ...added,
    ]);
  } finally {
    await mounted.unmount();
    f.close();
  }
});

test('a failed Save keeps the draft; held Save rejects cancel, Back and duplicate Save', async () => {
  const f = createHealthEvidenceTestDatabase();
  await runMigrations(f.database);
  const records = createRecordRepository(f.database);
  const { controller, mounted, openEditor } = await mountOverview(records);
  const write = records.transaction.bind(records);
  let release!: () => void;
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  const transactions = jest.spyOn(records, 'transaction');
  try {
    await openEditor();
    await fireEvent.press(choice('workouts'));
    transactions.mockRejectedValueOnce(new Error('Synthetic write failure'));
    await fireEvent.press(save());
    expect(await screen.findByText('선택을 저장하지 못했어요.')).toBeTruthy();
    expect(choice('workouts').props.accessibilityState.checked).toBe(true);
    expect(await loadOverviewMetricSelection(records)).toEqual(initial);
    transactions.mockImplementationOnce(async operation => {
      await held;
      return write(operation);
    });
    const press = fireEvent.press(save());
    await waitFor(() => expect(cancel()).toBeDisabled());
    expect(choice('workouts')).toBeDisabled();
    await act(async () => {
      expect(await controller.requestBack()).toBe(false);
    });
    await fireEvent.press(cancel());
    await fireEvent.press(save());
    expect(transactions).toHaveBeenCalledTimes(2);
    await act(async () => {
      release();
      await press;
    });
    await screen.findByTestId('overview-metric-workouts');
    expect(await loadOverviewMetricSelection(records)).toEqual([
      ...initial,
      'workouts',
    ]);
  } finally {
    release();
    transactions.mockRestore();
    await mounted.unmount();
    f.close();
  }
});
