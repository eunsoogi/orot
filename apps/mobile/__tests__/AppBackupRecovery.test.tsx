import { render, screen } from '@testing-library/react-native';
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

test('starts recording and database preparation from the initial app screen', async () => {
  // The welcome route is shown on mount, so backup preparation starts before storage-backed flows.
  await render(<App />);

  expect(await screen.findByTestId('backup-status-recovery')).toBeTruthy();
  expect(prepareRecordingsForBackup).toHaveBeenCalledTimes(1);
  expect(prepareDatabaseForBackup).toHaveBeenCalledTimes(1);
  expect(
    jest.mocked(prepareRecordingsForBackup).mock.invocationCallOrder[0],
  ).toBeLessThan(
    jest.mocked(prepareDatabaseForBackup).mock.invocationCallOrder[0],
  );
  expect(
    await screen.findByText(/백업을 위한 데이터 준비를 마쳤어요/u),
  ).toBeTruthy();
});
