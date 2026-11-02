import { fireEvent, render, screen } from '@testing-library/react-native';
import { HealthReviewScreen } from '../HealthReviewScreen';
import { HealthReviewSessionProvider } from '../HealthReviewSession';
import type { HealthReviewService } from '../service';

jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');
jest.mock('../../agent/execution/useInferenceConsent', () => ({
  useInferenceConsent: () => ({
    consent: { authorize: async () => 'renewal_required' },
    disclosureSheet: null,
  }),
}));

it('keeps safety choices and the authored name without obsolete manual blood-pressure inputs in the screen', async () => {
  const service: HealthReviewService = {
    list: jest.fn(async () => []),
    start: jest.fn(),
    continue: jest.fn(),
    delete: jest.fn(),
  };
  // Render the production composition so an input added outside SafetyForm is also detected.
  await render(
    <HealthReviewSessionProvider service={service}>
      <HealthReviewScreen onSource={jest.fn()} onProvider={jest.fn()} />
    </HealthReviewSessionProvider>,
  );
  await fireEvent.changeText(
    screen.getByTestId('health-review-name'),
    '검토 이름',
  );
  expect(screen.getByTestId('health-review-name')).toHaveProp(
    'value',
    '검토 이름',
  );
  for (const id of [
    'health-review-symptom-choices',
    'health-review-visit-choices',
    'health-review-population-choices',
  ])
    expect(screen.getByTestId(id)).toBeOnTheScreen();
  for (const id of [
    'health-review-context-choices',
    'health-review-systolic-0',
    'health-review-diastolic-0',
    'health-review-measuredAt-0',
    'health-review-source-0',
  ])
    expect(screen.queryByTestId(id)).toBeNull();
  for (const label of ['혈압 측정 상황', '혈압 입력 (선택)', '반복 측정 추가'])
    expect(screen.queryByText(label)).toBeNull();
});
