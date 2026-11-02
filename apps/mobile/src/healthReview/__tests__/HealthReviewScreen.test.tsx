import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { NavigationContext } from '@react-navigation/native';
import { t } from '../../i18n';
import { HealthReviewSessionProvider } from '../HealthReviewSession';
import { HealthReviewScreen } from '../HealthReviewScreen';
import { ReviewResult } from '../ReviewResult';
import {
  SafetyPolicyActionSchema,
  SafetyPolicyDecisionSchema,
} from '@orot/domain';
import { healthReviewText as copy } from '../../i18n/healthReview';
import type { HealthReviewService } from '../service';
import * as provider from '../../aiFeatures/integration/provider';
import {
  emptyHealthReviewSafety,
  healthReviewSafetyInput,
} from '../safetyInput';

jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');

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

it('places the shared AI selection in the heading and opens provider settings', async () => {
  const resolve = jest
    .spyOn(provider, 'resolveSelectedAiProvider')
    .mockResolvedValue({ status: 'selection-required' });
  const onProvider = jest.fn();
  await render(
    <HealthReviewSessionProvider service={service}>
      <HealthReviewScreen onSource={jest.fn()} onProvider={onProvider} />
    </HealthReviewSessionProvider>,
  );
  const selector = await screen.findByTestId('ai-feature-select-provider');
  expect(
    within(screen.getByTestId('health-review-heading')).getByTestId(
      'ai-feature-select-provider',
    ),
  ).toBeOnTheScreen();
  await fireEvent.press(selector);
  expect(onProvider).toHaveBeenCalledTimes(1);
  resolve.mockRestore();
});

it('refreshes the saved model after returning to a retained review scene', async () => {
  let focus = () => {};
  const navigation = {
    addListener: (_event: string, listener: () => void) => {
      focus = listener;
      return () => {};
    },
  };
  const resolve = jest
    .spyOn(provider, 'resolveSelectedAiProvider')
    .mockResolvedValueOnce({ status: 'selection-required' })
    .mockResolvedValue({ status: 'unavailable' });
  await render(
    <NavigationContext.Provider value={navigation as never}>
      <HealthReviewSessionProvider service={service}>
        <HealthReviewScreen onSource={jest.fn()} onProvider={jest.fn()} />
      </HealthReviewSessionProvider>
    </NavigationContext.Provider>,
  );
  expect(
    await screen.findByLabelText(new RegExp(t('provider.selection.rowPrompt'))),
  ).toBeOnTheScreen();
  await act(async () => focus());
  expect(
    await screen.findByLabelText(
      new RegExp(t('provider.selection.rowUnavailable')),
    ),
  ).toBeOnTheScreen();
  resolve.mockRestore();
});

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
  await fireEvent.press(
    screen.getByRole('radio', {
      name: '현재 증상 확인: 새롭거나 걱정되는 증상이 없음',
    }),
  );
  await fireEvent.press(
    screen.getByRole('radio', { name: '예정된 진료: 예정된 진료가 있음' }),
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
  expect(
    screen.getByRole('radio', {
      name: '현재 증상 확인: 새롭거나 걱정되는 증상이 없음',
      checked: true,
    }),
  ).toBeOnTheScreen();
  expect(
    screen.getByRole('radio', {
      name: '예정된 진료: 예정된 진료가 있음',
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

it('shows evidence insufficiency separately while retaining the unchanged policy guidance', async () => {
  const safety = SafetyPolicyDecisionSchema.parse({
    policyVersion: '1.0.0',
    category: 'insufficient_information',
    requiredActions: ['provide_required_information'],
    matchedRuleIds: [],
    missingInputs: ['blood_pressure_reading'],
  });
  await render(
    <ReviewResult
      state={{
        name: '',
        draft: emptyHealthReviewSafety(),
        requests: [],
        busy: false,
        safety,
        result: {
          status: 'needs_clarification',
          pending: {
            threadId: 'thread',
            sourceId: 'source',
            safety,
            references: [],
            reason: 'evidence',
            mode: 'record_observation',
          },
        },
      }}
      onSource={jest.fn()}
    />,
  );
  expect(screen.getByText(copy.evidenceInsufficient)).toBeOnTheScreen();
  expect(
    screen.getByText(copy.actions.provide_required_information),
  ).toBeOnTheScreen();
  expect(screen.getByText(/혈압 측정 기록/)).toBeOnTheScreen();
});

it('keeps blood-pressure policy context unknown while serializing the remaining explicit answers', () => {
  const empty = emptyHealthReviewSafety();
  expect(healthReviewSafetyInput(empty)).toEqual({
    requestType: 'health_review',
    population: 'unknown',
    readingContext: 'unknown',
    symptomAssessment: { status: 'unknown' },
  });
  expect(
    healthReviewSafetyInput({
      ...empty,
      population: 'adult_not_pregnant',
      symptoms: 'warning_signs',
      signs: ['chest_pain'],
      upcomingVisit: 'yes',
    }),
  ).toEqual({
    requestType: 'health_review',
    population: 'adult_not_pregnant',
    readingContext: 'unknown',
    symptomAssessment: { status: 'warning_signs', signs: ['chest_pain'] },
    hasUpcomingVisit: true,
  });
});
