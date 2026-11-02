import { fireEvent, render, screen } from '@testing-library/react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import { SafetyPolicyDecisionSchema } from '@orot/domain';
import { StyleSheet } from 'react-native';
import { healthReviewText as copy } from '../../i18n/healthReview';
import { appColorPalettes, appColors } from '../../layout/appColors';
import { ReviewResult } from '../ReviewResult';
import { SafetyForm } from '../SafetyForm';
import type { HealthReviewState } from '../controller';
import { emptyHealthReviewSafety } from '../safetyInput';

afterEach(() => jest.restoreAllMocks());

it('leaves an empty feedback area without an unnecessary card surface', async () => {
  await render(
    <ReviewResult
      state={{
        name: '',
        draft: emptyHealthReviewSafety(),
        requests: [],
        busy: false,
      }}
      onSource={jest.fn()}
    />,
  );

  const style = StyleSheet.flatten(
    screen.getByTestId('health-review-feedback-surface').props.style,
  );
  expect(style.backgroundColor).toBeUndefined();
  expect(style.borderRadius).toBeUndefined();
  expect(style.padding).toBeUndefined();
});

it('rounds choices without changing selected, disabled, or touch-target state', async () => {
  const onChange = jest.fn();
  await render(
    <SafetyForm
      draft={{
        ...emptyHealthReviewSafety(),
        population: 'adult_not_pregnant',
        symptoms: 'warning_signs',
        signs: ['chest_pain'],
      }}
      onChange={onChange}
      disabled
    />,
  );
  const selected = screen.getByRole('radio', {
    name: '대상 정보: 임신 중이 아닌 성인',
    checked: true,
    disabled: true,
  });
  const style = StyleSheet.flatten(selected.props.style);

  expect(style).toMatchObject({
    backgroundColor: appColors.primarySoft,
    borderRadius: 14,
    minHeight: 48,
  });
  expect(style.height).toBeUndefined();
  expect(style.overflow).toBeUndefined();
  const choiceLabel = screen.getByText('임신 중이 아닌 성인');
  expect(choiceLabel.props.allowFontScaling).not.toBe(false);
  expect(StyleSheet.flatten(choiceLabel.props.style).flexShrink).toBe(1);
  const selectedSign = screen.getByRole('checkbox', {
    name: '가슴 통증',
    checked: true,
    disabled: true,
  });
  expect(StyleSheet.flatten(selectedSign.props.style)).toMatchObject({
    backgroundColor: appColors.surface,
    borderRadius: 14,
    borderWidth: 1,
    opacity: 0.45,
  });
  expect(
    StyleSheet.flatten(
      screen.getByRole('checkbox', {
        name: '숨참',
        checked: false,
        disabled: true,
      }).props.style,
    ),
  ).toMatchObject({ backgroundColor: 'transparent' });
  await fireEvent.press(selectedSign);
  await fireEvent.press(selected);
  expect(onChange).not.toHaveBeenCalled();
});

it('keeps policy and provider errors readable within one rounded feedback surface', async () => {
  const safety = SafetyPolicyDecisionSchema.parse({
    policyVersion: '1.0.0',
    category: 'insufficient_information',
    requiredActions: ['provide_required_information'],
    matchedRuleIds: [],
    missingInputs: ['explicit_symptom_assessment'],
  });
  await render(
    <ReviewResult
      state={{
        name: '',
        draft: emptyHealthReviewSafety(),
        requests: [],
        busy: false,
        providerStatus: 'unavailable',
        safety,
      }}
      onSource={jest.fn()}
    />,
  );

  const surface = screen.getByTestId('health-review-feedback-surface');
  const style = StyleSheet.flatten(surface.props.style);
  expect(style).toMatchObject({
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
  });
  expect(style.height).toBeUndefined();
  expect(style.overflow).toBeUndefined();
  expect(appColorPalettes.light.surface).not.toBe(
    appColorPalettes.dark.surface,
  );
  expect(appColorPalettes.light.border).not.toBe(appColorPalettes.dark.border);
  expect(screen.getByText(copy.providerUnavailable)).toBeOnTheScreen();
  expect(
    screen.getByText(copy.actions.provide_required_information),
  ).toBeOnTheScreen();
  expect(screen.getByText(/현재 증상 여부/)).toBeOnTheScreen();
});

it('keeps source citations as flat actions inside the rounded review surface', async () => {
  const reference: EvidenceReference = {
    sourceKind: 'personal_record',
    sourceId: 'health-review-source',
    sourceRevision: '1',
    evidenceId: 'review-evidence',
    evidenceRevision: '1',
    locator: {},
    effectiveTime: null,
    reviewState: 'reviewed',
  };
  const safety = SafetyPolicyDecisionSchema.parse({
    policyVersion: '1.0.0',
    category: 'no_triggered_action',
    requiredActions: [],
    matchedRuleIds: [],
    missingInputs: [],
  });
  const state: HealthReviewState = {
    name: '',
    draft: emptyHealthReviewSafety(),
    requests: [],
    busy: false,
    result: {
      status: 'review',
      safety,
      review: {
        observedChanges: [
          {
            text: '심박 기록을 확인했어요.',
            evidenceIds: [reference.evidenceId],
          },
        ],
        unresolvedItems: [],
        questions: [],
      },
    },
    invocation: {
      aliases: new Map([[reference.evidenceId, reference]]),
    } as NonNullable<HealthReviewState['invocation']>,
  };
  const onSource = jest.fn();
  await render(<ReviewResult state={state} onSource={onSource} />);

  const surface = screen.getByTestId('health-review-feedback-surface');
  const citation = screen.getByTestId(
    `health-review-citation-${reference.evidenceId}`,
  );
  expect(StyleSheet.flatten(surface.props.style).borderRadius).toBe(16);
  expect(StyleSheet.flatten(citation.props.style)).toMatchObject({
    alignSelf: 'stretch',
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderRadius: 14,
  });
  await fireEvent.press(citation);
  expect(onSource).toHaveBeenCalledWith(reference);
});
