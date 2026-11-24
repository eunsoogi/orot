import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { HealthKitImportScreen } from '../HealthKitImportScreen';
import { createUnifiedImportCoordinator } from '../coordinator';
import { unifiedHealthImportCopy } from '../copy';
import { createTestServices } from '../testSupport';

// The original provider toggle does not silently request two new Apple read types.
test('keeps derived heart-rate import as independent explicit choices', async () => {
  const base = createTestServices();
  const start = jest.fn(createUnifiedImportCoordinator(base.services).start);
  await render(
    <HealthKitImportScreen
      copy={unifiedHealthImportCopy}
      coordinator={{ start }}
    />,
  );
  const feature = (name: string) =>
    screen.getByTestId(`unified-import-toggle-${name}`);
  await fireEvent.press(feature('healthKit'));
  expect(screen.getByText('안정 시 심박수')).toBeTruthy();
  expect(screen.getByText('걷기 평균 심박수')).toBeTruthy();
  expect(screen.getByText('건강 앱')).toBeTruthy();
  expect(feature('heartRate').props.accessibilityState.checked).toBe(true);
  expect(feature('restingHeartRate').props.accessibilityState.checked).toBe(
    false,
  );
  expect(
    feature('walkingHeartRateAverage').props.accessibilityState.checked,
  ).toBe(false);
  await fireEvent.press(feature('walkingHeartRateAverage'));
  await fireEvent.press(feature('healthKit'));
  expect(feature('heartRate').props.accessibilityState.checked).toBe(false);
  expect(
    feature('walkingHeartRateAverage').props.accessibilityState.checked,
  ).toBe(true);
  await fireEvent.press(screen.getByTestId('unified-import-start'));
  await waitFor(() =>
    expect(base.timeline).toContain(
      'healthKit.authorization:walkingHeartRateAverage',
    ),
  );
  expect(start.mock.calls[0]?.[0].healthKitFeatures).toEqual([
    'walkingHeartRateAverage',
  ]);
  expect(base.timeline).not.toContain(
    'healthKit.authorization:restingHeartRate',
  );
});
