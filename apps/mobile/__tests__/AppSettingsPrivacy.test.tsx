import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';
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
  const information = jest.spyOn(Alert, 'alert');
  const store = createAppointmentStore();
  await render(
    <App
      loadAppointments={async () => store.repository}
      loadRecordings={async () => []}
    />,
  );

  await fireEvent.press(screen.getByTestId('navigation-tab-settings'));
  expect(screen.getByTestId('settings-open-accounts')).toBeTruthy();
  expect(screen.getByTestId('settings-open-privacy-policy')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('settings-open-privacy'));
  expect(await screen.findByText('마이크')).toBeTruthy();
  for (const [title, summary] of [
    ['음성 인식', '전사할 때 요청'],
    ['건강 앱', '선택한 기록만'],
    ['캘린더', '일정을 가져올 때 요청'],
  ]) {
    expect(screen.queryByText(summary)).toBeNull();
    await fireEvent.press(
      screen.getByRole('button', { name: title + ' 정보' }),
    );
    expect(information).toHaveBeenLastCalledWith(
      title,
      expect.stringContaining(summary),
    );
  }
  expect(openSettings).not.toHaveBeenCalled();
  expect(screen.queryAllByRole('switch')).toHaveLength(0);
  expect(screen.queryByTestId('navigation-tab-settings')).toBeNull();
  await fireEvent.press(screen.getByTestId('privacy-open-system-settings'));
  await waitFor(() => expect(openSettings).toHaveBeenCalledTimes(1));
  openSettings.mockRejectedValueOnce(new Error('Settings unavailable'));
  await fireEvent.press(screen.getByTestId('privacy-open-system-settings'));
  expect(
    await screen.findByTestId('privacy-open-system-settings-error'),
  ).toBeTruthy();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  await waitFor(() =>
    expect(screen.getByTestId('settings-title')).toBeTruthy(),
  );
  expect(screen.getByTestId('navigation-tab-settings')).toBeVisible();
  await fireEvent.press(screen.getByTestId('settings-open-privacy-policy'));
  expect(
    await screen.findByTestId('settings-privacy-policy-title'),
  ).toHaveTextContent('개인정보 처리 방침');
  expect(screen.getByTestId('inference-consent-clear')).toBeTruthy();
  expect(screen.queryByTestId('privacy-open-system-settings')).toBeNull();
  information.mockRestore();
  openSettings.mockRestore();
});
