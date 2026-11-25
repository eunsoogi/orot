import { AppState } from 'react-native';
import { NavigationContext } from '@react-navigation/native';
import type { ContextType } from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { HealthObservationPageLoader } from '@orot/storage';
import { renderWithRootSafeArea } from '../../../test-support/safeAreaTestProviders';
import { ChartPlot } from '../../ui/charts';
import { HealthRecordsLibraryScreen } from '../HealthRecordsLibraryScreen';
import {
  resultFor,
  setup,
} from '../../routes/overview/testSupport/overviewWorkoutCardHarness';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  isCurrentLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));
jest.mock('../../ui/charts', () => ({
  ...jest.requireActual('../../ui/charts'),
  ChartPlot: jest.fn(() => null),
}));

const chart = jest.mocked(ChartPlot);

test('workout category selection supplies one owned month read without replacing duration or adding a button', async () => {
  const prior = AppState.currentState;
  AppState.currentState = 'active';
  const lane = await setup();
  try {
    lane.queryWorkoutPeriodHeartRate.mockImplementationOnce(async request => {
      const native = request as typeof request & {
        recordsMonthChart: { timeZone: string };
      };
      const timeZone = native.recordsMonthChart.timeZone;
      const first = Date.parse(native.fromInclusive) + 10_000;
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date(first));
      const part = (type: string) =>
        parts.find(item => item.type === type)?.value;
      const date = [part('year'), part('month'), part('day')].join('-');
      return {
        ...resultFor(native),
        mean: 120.99,
        timeZone,
        days: [
          { date, sampleCount: 5, minimum: 60, mean: 120.99, maximum: 180 },
        ],
      };
    });
    const loader: HealthObservationPageLoader = Object.assign(
      jest.fn(async () => ({ records: [], nextCursor: null })),
      { readMonthChart: jest.fn(async () => new Promise<never>(() => {})) },
    );
    let focused = true;
    const listeners = new Map<string, () => void>();
    const nav = {
      isFocused: () => focused,
      addListener: (kind: string, listener: () => void) => {
        listeners.set(kind, listener);
        return () => listeners.delete(kind);
      },
    } as unknown as NonNullable<ContextType<typeof NavigationContext>>;
    const view = await renderWithRootSafeArea(
      <NavigationContext.Provider value={nav}>
        <HealthRecordsLibraryScreen
          loadObservations={loader}
          onBack={jest.fn()}
          onOpenHealthImport={jest.fn()}
          onOpenDetail={jest.fn()}
        />
      </NavigationContext.Provider>,
    );
    expect(lane.queryWorkoutPeriodHeartRate).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('health-record-filter-all'));
    expect(lane.queryWorkoutPeriodHeartRate).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('health-record-filter-workouts'));
    await waitFor(() =>
      expect(
        screen.getByLabelText(
          /건강 앱이 운동에 연결한 최근 한 달 심박수, 120 BPM/,
        ),
      ).toBeTruthy(),
    );
    expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1);
    expect(lane.queryWorkoutHeartRate).not.toHaveBeenCalled();
    expect(lane.requestReadAuthorizations).not.toHaveBeenCalled();
    const duration = chart.mock.calls.find(
      child => child[0].testID === 'health-record-chart-values-workouts',
    )?.[0];
    const heart = chart.mock.calls.find(
      child => child[0].testID === 'health-records-workout-heart-rate-chart',
    )?.[0];
    expect(duration).toMatchObject({
      data: { metric: 'workouts' },
      hideSeriesLegend: true,
    });
    expect(screen.queryByText('120 BPM')).toBeNull();
    expect(
      screen.queryByText('건강 앱이 운동에 연결한 최근 한 달 심박수'),
    ).toBeNull();
    expect(heart).toMatchObject({
      kind: 'range',
      rangeAxis: 'day',
      data: { metric: 'heartRate' },
    });
    const points = heart?.data.series[0]?.points ?? [];
    expect(points.filter(point => point.value !== null)).toMatchObject([
      { value: 120.99, range: { minimum: 60, maximum: 180, samples: 5 } },
    ]);
    expect(points.length).toBeGreaterThan(27);
    expect(points.length).toBeLessThanOrEqual(33);
    await act(() => {
      focused = false;
      listeners.get('blur')?.();
    });
    expect(screen.queryByLabelText(/120 BPM/)).toBeNull();
    await act(() => {
      focused = true;
      listeners.get('focus')?.();
    });
    await waitFor(() => expect(screen.getByLabelText(/120 BPM/)).toBeTruthy());
    expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1);
    await act(() => lane.revoke());
    expect(screen.queryByLabelText(/120 BPM/)).toBeNull();
    await view.unmount();
  } finally {
    AppState.currentState = prior;
    lane.close();
  }
});

test('a late native protection restore retries a previously unavailable Workout read', async () => {
  const prior = AppState.currentState;
  AppState.currentState = 'active';
  const lane = await setup();
  try {
    lane.queryWorkoutPeriodHeartRate.mockRejectedValueOnce(
      new Error('transient synthetic native failure'),
    );
    const loader: HealthObservationPageLoader = Object.assign(
      jest.fn(async () => ({ records: [], nextCursor: null })),
      { readMonthChart: jest.fn(async () => new Promise<never>(() => {})) },
    );
    const view = await renderWithRootSafeArea(
      <HealthRecordsLibraryScreen
        loadObservations={loader}
        onBack={jest.fn()}
        onOpenHealthImport={jest.fn()}
        onOpenDetail={jest.fn()}
      />,
    );
    await fireEvent.press(screen.getByTestId('health-record-filter-workouts'));
    await waitFor(() =>
      expect(
        screen.getByText(/운동과 연결된 심박수를 확인할 수 없어요/),
      ).toBeTruthy(),
    );
    expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1);
    await act(() => lane.restoreProtection());
    await waitFor(() => expect(screen.getByLabelText(/120 BPM/)).toBeTruthy());
    expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(2);
    expect(lane.requestReadAuthorizations).not.toHaveBeenCalled();
    await view.unmount();
  } finally {
    AppState.currentState = prior;
    lane.close();
  }
});

test.each([
  ['emptyVisible', '이 기간에 표시할 운동 심박수 기록이 없어요.'],
  ['unavailable', '이 기간에 운동과 연결된 심박수를 확인할 수 없어요.'],
])(
  'Workout differentiates a proved empty period from failed access (%s)',
  async (status, message) => {
    const prior = AppState.currentState;
    AppState.currentState = 'active';
    const lane = await setup();
    try {
      lane.queryWorkoutPeriodHeartRate.mockImplementationOnce(
        async request => ({
          ...resultFor(request),
          status,
        }),
      );
      const loader: HealthObservationPageLoader = Object.assign(
        jest.fn(async () => ({ records: [], nextCursor: null })),
        { readMonthChart: jest.fn(async () => new Promise<never>(() => {})) },
      );
      const view = await renderWithRootSafeArea(
        <HealthRecordsLibraryScreen
          loadObservations={loader}
          onBack={jest.fn()}
          onOpenHealthImport={jest.fn()}
          onOpenDetail={jest.fn()}
        />,
      );
      await fireEvent.press(
        screen.getByTestId('health-record-filter-workouts'),
      );
      await waitFor(() => expect(screen.getByText(message)).toBeTruthy());
      expect(
        screen.queryByLabelText(/건강 앱이 운동에 연결한 최근 한 달 심박수/),
      ).toBeNull();
      expect(screen.queryByLabelText(/0 BPM/)).toBeNull();
      expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1);
      expect(lane.requestReadAuthorizations).not.toHaveBeenCalled();
      await view.unmount();
    } finally {
      AppState.currentState = prior;
      lane.close();
    }
  },
);
