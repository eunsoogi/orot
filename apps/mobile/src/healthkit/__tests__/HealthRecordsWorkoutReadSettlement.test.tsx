import { AppState } from 'react-native';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { HealthObservationPageLoader } from '@orot/storage';
import { renderWithRootSafeArea } from '../../../test-support/safeAreaTestProviders';
import {
  resultFor,
  setup,
} from '../../routes/overview/testSupport/overviewWorkoutCardHarness';
import { syncCommonObservationChanges } from '../commonObservations/sync';
import { healthKitSample } from '../commonObservations/testSupport';
import { healthKit, page } from '../commonObservations/testSyncSupport';
import { HealthRecordsLibraryScreen } from '../HealthRecordsLibraryScreen';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  isCurrentLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));

const empty = /이 기간에 표시할 운동 심박수 기록이 없어요/;
const unavailable = /운동과 연결된 심박수를 확인할 수 없어요/;
const state = () =>
  screen.getByTestId('health-records-workout-month-heart-rate');
const loader: HealthObservationPageLoader = Object.assign(
  jest.fn(async () => ({ records: [], nextCursor: null })),
  { readMonthChart: jest.fn(async () => new Promise<never>(() => {})) },
);

async function openWorkoutFilter() {
  const screenView = await renderWithRootSafeArea(
    <HealthRecordsLibraryScreen
      loadObservations={loader}
      onBack={jest.fn()}
      onOpenHealthImport={jest.fn()}
      onOpenDetail={jest.fn()}
    />,
  );
  await fireEvent.press(screen.getByTestId('health-record-filter-workouts'));
  return screenView;
}

test.each([false, true])(
  'a committed SQLite startup writer permits one fresh workout read unless protection is revoked: %s',
  async revoked => {
    const prior = AppState.currentState;
    AppState.currentState = 'active';
    const lane = await setup();
    const writer = await lane.holdStartupWriter();
    try {
      const view = await openWorkoutFilter();
      expect(state()).toHaveTextContent(/불러오는 중/);
      expect(state()).not.toHaveTextContent(unavailable);
      expect(lane.queryWorkoutPeriodHeartRate).not.toHaveBeenCalled();
      if (revoked) await act(() => lane.revoke());
      await act(() => writer.release());
      if (revoked) {
        expect(lane.queryWorkoutPeriodHeartRate).not.toHaveBeenCalled();
        expect(state()).not.toHaveTextContent(/120 BPM/);
      } else {
        await waitFor(() =>
          expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1),
        );
        await waitFor(() =>
          expect(state()).not.toHaveTextContent(/불러오는 중/),
        );
        expect(state()).not.toHaveTextContent(unavailable);
      }
      expect(lane.requestReadAuthorizations).not.toHaveBeenCalled();
      await view.unmount();
    } finally {
      await writer.release();
      lane.close();
      AppState.currentState = prior;
    }
  },
);

test.each(['unavailable', 'emptyVisible'] as const)(
  'a focused Workout filter with %s refreshes on committed changes, not unrelated or no-op sync',
  async status => {
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
      const view = await openWorkoutFilter();
      const provedEmpty = status === 'emptyVisible';
      await waitFor(() =>
        expect(state()).toHaveTextContent(provedEmpty ? empty : unavailable),
      );
      expect(state()).not.toHaveTextContent(provedEmpty ? unavailable : empty);
      expect(screen.queryByLabelText(/\d BPM/)).toBeNull();
      const now = () => new Date().toISOString();
      const workout = healthKitSample('workouts', {
        id: '195dd035-5be5-4124-ad39-113445fb56c4',
        startDate: new Date(Date.now() - 120_000).toISOString(),
        endDate: new Date(Date.now() - 60_000).toISOString(),
      });
      await act(async () => {
        await syncCommonObservationChanges({
          feature: 'steps',
          repository: lane.repository,
          now,
          healthKit: healthKit([
            page({ addedSamples: [healthKitSample('steps')], cursor: 'steps' }),
          ]),
        });
        await syncCommonObservationChanges({
          feature: 'workouts',
          repository: lane.repository,
          now,
          healthKit: healthKit([page({ cursor: 'workout-empty' })]),
        });
      });
      expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1);
      await act(() =>
        syncCommonObservationChanges({
          feature: 'workouts',
          repository: lane.repository,
          now,
          healthKit: healthKit([
            page({ addedSamples: [workout], cursor: 'workout-change' }),
          ]),
        }),
      );
      await waitFor(() =>
        expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(2),
      );
      expect(
        lane.queryWorkoutPeriodHeartRate.mock.calls[1]?.[0].workouts,
      ).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: workout.id })]),
      );
      expect(lane.requestReadAuthorizations).not.toHaveBeenCalled();
      await view.unmount();
    } finally {
      lane.close();
      AppState.currentState = prior;
    }
  },
);

test.each(['restored', 'unchanged', 'revoked'] as const)(
  'an older negative protection reply cannot discard a newer restoration: %s',
  async outcome => {
    const prior = AppState.currentState;
    AppState.currentState = 'active';
    const lane = await setup();
    const probe = lane.holdFirstProtectionProbe();
    lane.queryWorkoutPeriodHeartRate.mockImplementationOnce(async request => {
      const result = resultFor(request);
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date(result.firstSampleAtMs));
      const date = ['year', 'month', 'day']
        .map(type => parts.find(part => part.type === type)?.value)
        .join('-');
      const { sampleCount, minimum, mean, maximum } = result;
      return {
        ...result,
        timeZone,
        days: [{ date, sampleCount, minimum, mean, maximum }],
      };
    });
    try {
      const view = await openWorkoutFilter();
      await probe.entered;
      expect(lane.queryWorkoutPeriodHeartRate).not.toHaveBeenCalled();
      await act(async () => {
        if (outcome !== 'unchanged') lane.restoreProtection();
        if (outcome === 'revoked') lane.revoke();
        probe.release(false);
      });
      if (outcome === 'restored') {
        await waitFor(() =>
          expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1),
        );
        await waitFor(() =>
          expect(
            screen.getByLabelText(/최근 한 달 심박수, 120 BPM/),
          ).toBeTruthy(),
        );
        expect(probe.probes()).toBeGreaterThan(1);
      } else {
        expect(lane.queryWorkoutPeriodHeartRate).not.toHaveBeenCalled();
        expect(probe.probes()).toBe(1);
      }
      expect(lane.requestReadAuthorizations).not.toHaveBeenCalled();
      await view.unmount();
    } finally {
      lane.close();
      AppState.currentState = prior;
    }
  },
);
