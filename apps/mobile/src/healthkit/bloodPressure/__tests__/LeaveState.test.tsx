import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { NavigationLeaveState } from '../../../navigation/navigationLeaveGuard';
import {
  NavigationLeaveStateRegistrationProvider,
  type NavigationLeaveStateRegistration,
} from '../../../navigation';
import { BloodPressureImportScreen } from '../BloodPressureImportScreen';
import type { BloodPressureSyncResult } from '../types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

test('keeps the shared back state denied until import completes', async () => {
  let registered: { readState: () => NavigationLeaveState } | undefined;
  const registerLeaveState: NavigationLeaveStateRegistration = source => {
    registered = source;
    return () => {};
  };
  const result = deferred<BloodPressureSyncResult>();
  await render(
    <NavigationLeaveStateRegistrationProvider
      registerLeaveState={registerLeaveState}
    >
      <BloodPressureImportScreen
        onBack={jest.fn()}
        onOpenLibrary={jest.fn()}
        importBloodPressure={() => result.promise}
      />
    </NavigationLeaveStateRegistrationProvider>,
  );
  await screen.findByTestId('blood-pressure-status');

  const readState = () => {
    if (!registered) throw new Error('Leave state was not registered.');
    return registered.readState();
  };
  expect(readState().canLeave).toBe(true);
  await fireEvent.press(screen.getByTestId('blood-pressure-import'));

  expect(readState()).toMatchObject({
    canLeave: false,
    hasOngoingOperation: false,
  });
  expect(screen.queryByTestId('blood-pressure-back')).toBeNull();

  result.resolve({
    status: 'completed',
    readAuthorization: 'notObservable',
    upserted: 0,
    deleted: 0,
    cursorAdvanced: true,
  });
  await waitFor(() => expect(readState().canLeave).toBe(true));
});
