import { AppState, type AppStateStatus } from 'react-native';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { HealthObservationPageLoader } from '@orot/storage';
import { renderWithRootSafeArea } from '../../../test-support/safeAreaTestProviders';
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

test.each(['same', 'locked', 'source revised', 'background'] as const)(
  'same Records route never republishes an invalid prior workout snapshot: %s',
  async mode => {
    const prior = AppState.currentState;
    AppState.currentState = 'active';
    const lane = await setup();
    const callbacks = new Set<(phase: AppStateStatus) => void>();
    const subscribe = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_kind, cb) => {
        callbacks.add(cb);
        return {
          remove: () => {
            callbacks.delete(cb);
          },
        };
      });
    const phase = (state: 'active' | 'inactive' | 'background') =>
      act(() => {
        AppState.currentState = state;
        lane.transition(state);
        for (const cb of [...callbacks]) cb(state);
      });
    let release!: (value: ReturnType<typeof resultFor>) => void;
    const held = new Promise<ReturnType<typeof resultFor>>(done => {
      release = done;
    });
    try {
      const loader: HealthObservationPageLoader = Object.assign(
        jest.fn(async () => ({ records: [], nextCursor: null })),
        { readMonthChart: jest.fn(async () => new Promise<never>(() => {})) },
      );
      lane.queryWorkoutPeriodHeartRate
        .mockImplementationOnce(async request => resultFor(request))
        .mockReturnValueOnce(held);
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
      await waitFor(() =>
        expect(screen.getByLabelText(/120 BPM/)).toBeTruthy(),
      );
      await phase('inactive');
      expect(screen.queryByLabelText(/120 BPM/)).toBeNull();
      if (mode === 'locked') await act(() => lane.revoke());
      else if (mode === 'source revised')
        await lane.repository.put('health_observation', lane.first);
      else if (mode === 'background') await phase('background');
      await phase('active');
      expect(Boolean(screen.queryByLabelText(/120 BPM/))).toBe(mode === 'same');
      expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(
        mode === 'source revised' || mode === 'background' ? 2 : 1,
      );
      expect(lane.requestReadAuthorizations).not.toHaveBeenCalled();
      await act(() => lane.revoke());
      expect(screen.queryByLabelText(/120 BPM/)).toBeNull();
      await view.unmount();
    } finally {
      const req = lane.queryWorkoutPeriodHeartRate.mock.calls[1]?.[0];
      if (req) release(resultFor(req));
      subscribe.mockRestore();
      AppState.currentState = prior;
      lane.close();
    }
  },
);
