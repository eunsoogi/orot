import { render, screen } from '@testing-library/react-native';
import App from '../App';
import { prepareBackupSupport } from '../src/backup/backupSupport';

jest.mock('../src/backup/backupSupport', () => ({
  prepareBackupSupport: jest.fn(),
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
  jest.mocked(prepareBackupSupport).mockResolvedValue('ready');
});

test('starts backup recovery preparation from the initial app screen', async () => {
  // The welcome route is shown on mount, so backup preparation starts before storage-backed flows.
  await render(<App />);

  expect(await screen.findByTestId('backup-status-recovery')).toBeTruthy();
  expect(prepareBackupSupport).toHaveBeenCalledTimes(1);
  expect(
    await screen.findByText(/백업을 위한 데이터 준비를 마쳤어요/u),
  ).toBeTruthy();
});
