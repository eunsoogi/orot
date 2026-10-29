import { fireEvent, render, screen } from '@testing-library/react-native';
import { HealthReviewSessionProvider } from '../HealthReviewSession';
import { HealthReviewScreen } from '../HealthReviewScreen';
import { ReviewResult } from '../ReviewResult';
import { SafetyPolicyActionSchema } from '@orot/domain';
import { healthReviewText as copy } from '../../i18n/healthReview';
import type { HealthReviewService } from '../service';
import {
  emptyHealthReviewSafety,
  healthReviewSafetyInput,
} from '../safetyInput';

jest.mock('../../agent/execution/useInferenceConsent', () => ({
  useInferenceConsent: () => ({
    consent: { authorize: async () => 'renewal_required' },
    disclosureSheet: null,
  }),
}));

const service: HealthReviewService = {
  list: jest.fn(async () => []),
  start: jest.fn(),
  continue: jest.fn(),
  delete: jest.fn(),
};

it('retains authored name and genuine safety answers while the view leaves and returns', async () => {
  const wrapper = (visible: boolean) => (
    <HealthReviewSessionProvider service={service}>
      {visible ? (
        <HealthReviewScreen onSource={jest.fn()} onProvider={jest.fn()} />
      ) : null}
    </HealthReviewSessionProvider>
  );
  const view = await render(wrapper(true));
  await fireEvent.changeText(
    screen.getByTestId('health-review-name'),
    '이번 주 건강 기록',
  );
  await fireEvent.press(
    screen.getByRole('radio', { name: '대상 정보: 임신 중이 아닌 성인' }),
  );
  await view.rerender(wrapper(false));
  await view.rerender(wrapper(true));
  expect(screen.getByTestId('health-review-name')).toHaveDisplayValue(
    '이번 주 건강 기록',
  );
  expect(
    screen.getByRole('radio', {
      name: '대상 정보: 임신 중이 아닌 성인',
      checked: true,
    }),
  ).toBeOnTheScreen();
  expect(service.start).not.toHaveBeenCalled();
  expect(service.continue).not.toHaveBeenCalled();
});

it('renders every policy action during insufficient-information guidance and provider failure', async () => {
  await render(
    <ReviewResult
      state={{
        name: '',
        draft: emptyHealthReviewSafety(),
        requests: [],
        busy: false,
        providerStatus: 'unavailable',
        safety: {
          policyVersion: '1.0.0',
          category: 'insufficient_information',
          requiredActions: [...SafetyPolicyActionSchema.options],
          matchedRuleIds: [],
          missingInputs: ['explicit_symptom_assessment'],
        },
      }}
      onSource={jest.fn()}
    />,
  );
  for (const action of SafetyPolicyActionSchema.options)
    expect(screen.getByText(copy.actions[action])).toBeOnTheScreen();
  expect(screen.getByText(copy.providerUnavailable)).toBeOnTheScreen();
  expect(screen.getByText(/현재 증상 여부/)).toBeOnTheScreen();
});

it('retains unknown facts and rejects a partial measurement without substituting a normal reading', () => {
  expect(healthReviewSafetyInput(emptyHealthReviewSafety())).toEqual({
    requestType: 'health_review',
    population: 'unknown',
    readingContext: 'unknown',
    symptomAssessment: { status: 'unknown' },
  });
  expect(() =>
    healthReviewSafetyInput({
      ...emptyHealthReviewSafety(),
      readings: [
        { systolic: '120', diastolic: '', measuredAt: '', source: '' },
      ],
    }),
  ).toThrow();
});
