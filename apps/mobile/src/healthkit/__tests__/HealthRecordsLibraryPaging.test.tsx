import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { HealthObservationPage } from '@orot/storage';
import { HealthRecordsLibraryScreen } from '../HealthRecordsLibraryScreen';
import { NavigationLeaveStateRegistrationProvider } from '../../navigation/useNavigationLeaveStateRegistration';
import type { NavigationLeaveStateRegistration } from '../../navigation/useNavigationLeaveStateRegistration';

function deferred() {
  let resolve!: (page: HealthObservationPage) => void;
  const promise = new Promise<HealthObservationPage>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

test('a pending library read registers safe leave state', async () => {
  const request = deferred();
  const register = jest.fn<
    ReturnType<NavigationLeaveStateRegistration>,
    Parameters<NavigationLeaveStateRegistration>
  >(() => () => {});
  await render(
    <NavigationLeaveStateRegistrationProvider registerLeaveState={register}>
      <HealthRecordsLibraryScreen
        loadObservations={() => request.promise}
        onBack={jest.fn()}
      />
    </NavigationLeaveStateRegistrationProvider>,
  );
  expect(screen.getByTestId('health-records-loading')).toBeTruthy();
  const source = register.mock.calls[register.mock.calls.length - 1]?.[0];
  expect(source?.readState()).toMatchObject({
    canLeave: true,
    hasUnsavedChanges: false,
    hasOngoingOperation: false,
  });
  await act(async () => request.resolve({ records: [], nextCursor: null }));
});

test('late loader responses cannot overwrite a new library request', async () => {
  const old = deferred();
  const current = deferred();
  const view = await render(
    <HealthRecordsLibraryScreen
      loadObservations={() => old.promise}
      onBack={jest.fn()}
    />,
  );
  await view.rerender(
    <HealthRecordsLibraryScreen
      loadObservations={() => current.promise}
      onBack={jest.fn()}
    />,
  );
  await act(async () => current.resolve({ records: [], nextCursor: null }));
  await act(async () =>
    old.resolve({
      records: [],
      nextCursor: { id: 'stale', effectiveAt: '2026-10-01T00:00:00Z' },
    }),
  );
  expect(screen.getByTestId('health-records-empty')).toBeTruthy();
  expect(screen.queryByTestId('health-records-loading')).toBeNull();
});

test('coalesces repeated end events while the next page is pending', async () => {
  const next = deferred();
  const cursor = { id: 'cursor', effectiveAt: '2026-10-01T00:00:00Z' };
  const loader = jest
    .fn()
    .mockResolvedValueOnce({ records: [], nextCursor: cursor })
    .mockImplementation(() => next.promise);
  await render(
    <HealthRecordsLibraryScreen loadObservations={loader} onBack={jest.fn()} />,
  );
  await fireEvent(screen.getByTestId('health-records-scroll'), 'endReached');
  await fireEvent(screen.getByTestId('health-records-scroll'), 'endReached');
  expect(loader).toHaveBeenCalledTimes(2);
  expect(loader).toHaveBeenLastCalledWith(cursor);
  await act(async () => next.resolve({ records: [], nextCursor: null }));
});
