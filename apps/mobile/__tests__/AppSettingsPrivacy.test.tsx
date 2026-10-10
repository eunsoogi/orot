import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Linking } from 'react-native';
import App from '../App';
import { createAppointmentStore } from '../test-helpers/appointmentStore';

jest.mock('../src/healthkit/commonObservations/importLocal', () => ({
  importLocalCommonObservations: jest.fn(),
}));
jest.mock('../src/healthkit/bloodPressure/importLocal', () => ({
  importLocalBloodPressure: jest.fn(),
  listLocalBloodPressureObservations: jest.fn(),
}));
jest.mock('../src/backup/backupSupport', () => ({
  prepareBackupSupport: jest.fn(async () => 'ready'),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

test('shows concrete permission guidance and opens the iOS app settings page', async () => {
  const openSettings = jest
    .spyOn(Linking, 'openSettings')
    .mockResolvedValue(undefined);
  const store = createAppointmentStore();
  await render(
    <App
      loadAppointments={async () => store.repository}
      loadRecordings={async () => []}
    />,
  );

  await fireEvent.press(screen.getByTestId('navigation-tab-settings'));
  expect(screen.getByTestId('settings-open-accounts')).toBeTruthy();
  expect(screen.getByTestId('settings-open-backup')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('settings-open-privacy'));
  expect(await screen.findByText('마이크')).toBeTruthy();
  expect(screen.getByText('전사할 때 요청')).toBeTruthy();
  expect(screen.getByText('선택한 기록만')).toBeTruthy();
  expect(screen.getByText('일정을 가져올 때 요청')).toBeTruthy();
  expect(screen.queryAllByRole('switch')).toHaveLength(0);
  expect(screen.queryByTestId('navigation-tab-settings')).toBeNull();
  await fireEvent.press(screen.getByTestId('privacy-open-system-settings'));
  await waitFor(() => expect(openSettings).toHaveBeenCalledTimes(1));
  await fireEvent.press(screen.getByTestId('navigation-back'));
  await waitFor(() =>
    expect(screen.getByTestId('settings-title')).toBeTruthy(),
  );
  expect(screen.getByTestId('navigation-tab-settings')).toBeVisible();
});
