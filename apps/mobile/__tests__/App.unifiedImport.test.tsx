import { fireEvent, render, screen } from '@testing-library/react-native';
import App from '../App';
import { createUnifiedImportCoordinator } from '../src/healthkit/unifiedImport/coordinator';
import { createTestServices } from '../src/healthkit/unifiedImport/testSupport';

// Unrelated App routes stay isolated from SQLite and native provider bridges.
jest.mock('../src/healthkit/commonObservations/importLocal', () => ({
  importLocalCommonObservations: jest.fn(),
}));
jest.mock('../src/healthkit/bloodPressure/importLocal', () => ({
  importLocalBloodPressure: jest.fn(),
  listLocalBloodPressureObservations: jest.fn(),
}));
// The startup recovery flow is covered separately without loading native backup modules.
jest.mock('../src/backup/backupSupport', () => ({
  prepareBackupSupport: jest.fn(async () => 'ready'),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

test('opens the unified provider flow from the production welcome route', async () => {
  const base = createTestServices();
  const coordinator = createUnifiedImportCoordinator(base.services);
  // Replace only native services; App still resolves its production coordinator entry point.
  jest.doMock('../src/healthkit/unifiedImport/localImport', () => ({
    unifiedHealthImportCoordinator: coordinator,
  }));
  await render(<App />);

  await fireEvent.press(screen.getByTestId('open-unified-health-import'));
  expect(
    screen.getByRole('header', { name: 'HealthKit 및 캘린더 가져오기' }),
  ).toBeTruthy();
  expect(screen.getByTestId('safe-area-root')).toBeVisible();
  expect(screen.queryByTestId('safe-area-scroll')).toBeNull();
  expect(screen.getByTestId('unified-import-toggle-eventKit')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('unified-import-toggle-heartRate'));
  await fireEvent.press(screen.getByTestId('unified-import-toggle-eventKit'));
  await fireEvent.press(screen.getByTestId('unified-import-start'));

  expect(
    await screen.findByTestId('unified-import-eventkit-candidate-0'),
  ).toBeTruthy();
  await fireEvent.press(screen.getByTestId('unified-import-eventkit-select-0'));
  await fireEvent.press(screen.getByTestId('unified-import-eventkit-confirm'));
  expect(
    await screen.findByTestId('unified-import-eventkit-confirmed'),
  ).toBeTruthy();
  expect(base.timeline).toEqual(
    expect.arrayContaining([
      'healthKit.authorization:heartRate',
      'eventKit.authorization',
      'eventKit.query',
      'storage.open',
      'query:heartRate',
    ]),
  );

  await fireEvent.press(screen.getByTestId('healthkit-unified-import-back'));
  expect(screen.getByTestId('welcome-title')).toBeTruthy();

  // Reopening through the production route must not resume or duplicate the completed import.
  const completedTimeline = [...base.timeline];
  await fireEvent.press(screen.getByTestId('open-unified-health-import'));
  expect(
    screen.getByRole('header', { name: 'HealthKit 및 캘린더 가져오기' }),
  ).toBeTruthy();
  expect(screen.getByTestId('unified-import-start')).toBeDisabled();
  expect(
    screen.queryByTestId('unified-import-eventkit-candidate-0'),
  ).toBeNull();
  expect(screen.queryByTestId('unified-import-eventkit-confirmed')).toBeNull();
  expect(base.timeline).toEqual(completedTimeline);
});
