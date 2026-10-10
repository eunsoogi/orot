import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Linking } from 'react-native';
import App from '../App';
import { prepareRecordingsForBackup } from '../src/backup/nativeBackupMigration';
import { prepareDatabaseForBackup } from '../src/storage/secureDatabase';

// Stub native edges while exercising the real App, recovery component, and preparation flow.
jest.mock('../src/backup/nativeBackupMigration', () => ({
  prepareRecordingsForBackup: jest.fn(),
}));

jest.mock('../src/storage/secureDatabase', () => ({
  prepareDatabaseForBackup: jest.fn(),
}));

jest.mock('../src/healthkit/commonObservations/importLocal', () => ({
  importLocalCommonObservations: jest.fn(),
}));

jest.mock('../src/healthkit/bloodPressure/importLocal', () => ({
  importLocalBloodPressure: jest.fn(),
  listLocalBloodPressureObservations: jest.fn(),
}));

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(prepareRecordingsForBackup).mockResolvedValue(1);
  jest.mocked(prepareDatabaseForBackup).mockResolvedValue(undefined);
});

test('prepares local backup support at startup and shows its status in Settings', async () => {
  await render(<App />);

  await waitFor(() =>
    expect(prepareRecordingsForBackup).toHaveBeenCalledTimes(1),
  );
  expect(screen.queryByTestId('backup-status-recovery')).toBeNull();
  expect(prepareRecordingsForBackup).toHaveBeenCalledTimes(1);
  expect(prepareDatabaseForBackup).toHaveBeenCalledTimes(1);
  expect(
    jest.mocked(prepareRecordingsForBackup).mock.invocationCallOrder[0],
  ).toBeLessThan(
    jest.mocked(prepareDatabaseForBackup).mock.invocationCallOrder[0],
  );
  await fireEvent.press(screen.getByTestId('navigation-tab-settings'));
  expect(screen.getByTestId('settings-open-backup')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('settings-open-backup'));
  expect(await screen.findByTestId('backup-status-recovery')).toBeTruthy();
  expect(
    await screen.findByText(/백업을 위한 데이터 준비를 마쳤어요/u),
  ).toBeTruthy();
  expect(screen.getByText('복구 상태')).toBeTruthy();
  expect(screen.getByText('확인 전')).toBeTruthy();
  expect(
    screen.getByText(/iCloud 백업 완료 여부는 iOS 설정에서 확인/u),
  ).toBeTruthy();
  expect(screen.getByTestId('backup-prepare')).toBeEnabled();
  await fireEvent.press(screen.getByTestId('backup-prepare'));
  await waitFor(() =>
    expect(prepareRecordingsForBackup).toHaveBeenCalledTimes(2),
  );
  const openSettings = jest
    .spyOn(Linking, 'openSettings')
    .mockResolvedValue(undefined);
  await fireEvent.press(screen.getByTestId('backup-open-system-settings'));
  await waitFor(() => expect(openSettings).toHaveBeenCalledTimes(1));
});
