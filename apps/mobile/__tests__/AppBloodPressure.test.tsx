import { fireEvent, render, screen } from '@testing-library/react-native';
import App from '../App';
import {
  importLocalBloodPressure,
  listLocalBloodPressureObservations,
} from '../src/healthkit/bloodPressure/importLocal';
import { mapBloodPressureCorrelation } from '../src/healthkit/bloodPressure/mapper';
import { correlation } from '../src/healthkit/bloodPressure/testSupport';

jest.mock('../src/healthkit/bloodPressure/importLocal', () => ({
  importLocalBloodPressure: jest.fn(),
  listLocalBloodPressureObservations: jest.fn(),
}));
jest.mock('../src/healthkit/commonObservations/importLocal', () => ({
  importLocalCommonObservations: jest.fn(),
}));

// Detox covers this route with a synthetic HealthKit fixture; no real account is read.
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

test('opens the BP import screen, displays persisted source status, and returns home', async () => {
  const observations = mapBloodPressureCorrelation(
    correlation('app-screen-correlation'),
    '2026-10-05T10:00:00.000Z',
  ).observations;
  jest
    .mocked(listLocalBloodPressureObservations)
    .mockResolvedValue([...observations]);
  jest.mocked(importLocalBloodPressure).mockResolvedValue({
    status: 'completed',
    readAuthorization: 'notObservable',
    upserted: 0,
    deleted: 0,
    cursorAdvanced: false,
  });
  await render(<App />);

  await fireEvent.press(screen.getByTestId('open-blood-pressure-import'));
  expect(await screen.findByRole('header', { name: '혈압 기록' })).toBeTruthy();
  expect(await screen.findByText('수축기 120 mmHg')).toBeTruthy();
  expect(screen.getAllByText('원본 정보 제공 안 됨')).toHaveLength(2);
  expect(importLocalBloodPressure).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId('blood-pressure-import'));
  expect(importLocalBloodPressure).toHaveBeenCalledTimes(1);
  expect(
    await screen.findByText('새로운 혈압 기록 변경이 없어요.'),
  ).toBeTruthy();

  await fireEvent.press(screen.getByTestId('blood-pressure-back'));
  expect(screen.getByTestId('welcome-title')).toBeTruthy();
});
