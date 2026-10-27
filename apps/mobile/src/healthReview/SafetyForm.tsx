import { View, TextInput } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import { healthReviewText as copy } from '../i18n/healthReview';
import type { HealthReviewSafetyDraft } from './safetyInput';
import { emptySafetyReading } from './safetyInput';
import { healthReviewStyles as styles } from './styles';

function Choices<T extends string>({
  label,
  values,
  selected,
  onSelect,
}: {
  label: string;
  values: readonly (readonly [T, string])[];
  selected: T;
  onSelect: (value: T) => void;
}) {
  return (
    <View>
      <Text accessibilityRole="header">{label}</Text>
      {values.map(([value, title]) => (
        <AppButton
          key={value}
          title={title}
          accessibilityLabel={`${label}: ${title}`}
          accessibilityState={{ selected: selected === value }}
          onPress={() => onSelect(value)}
        />
      ))}
    </View>
  );
}
const signs = [
  ['chest_pain', '가슴 통증'],
  ['shortness_of_breath', '숨참'],
  ['back_pain', '등 통증'],
  ['numbness', '감각 저하'],
  ['weakness', '힘이 빠짐'],
  ['vision_change', '시야 변화'],
  ['difficulty_speaking', '말하기 어려움'],
] as const;

/** Every fact is supplied by a person; unknown is retained until an explicit answer changes it. */
export function SafetyForm({
  draft,
  onChange,
  disabled,
}: {
  draft: HealthReviewSafetyDraft;
  onChange: (value: HealthReviewSafetyDraft) => void;
  disabled: boolean;
}) {
  const set = <K extends keyof HealthReviewSafetyDraft>(
    key: K,
    value: HealthReviewSafetyDraft[K],
  ) => {
    if (!disabled) onChange({ ...draft, [key]: value });
  };
  return (
    <View style={styles.form}>
      <Choices
        label={copy.population}
        selected={draft.population}
        onSelect={value => set('population', value)}
        values={[
          ['unknown', copy.unknown],
          ['adult_not_pregnant', '임신 중이 아닌 성인'],
          ['pregnant', '임신 중'],
          ['child', '아동'],
        ]}
      />
      <Choices
        label={copy.context}
        selected={draft.readingContext}
        onSelect={value => set('readingContext', value)}
        values={[
          ['unknown', copy.unknown],
          ['current_measurement', '현재 측정'],
          ['historical', '과거 측정'],
        ]}
      />
      <Choices
        label={copy.symptoms}
        selected={draft.symptoms}
        onSelect={value => set('symptoms', value)}
        values={[
          ['unknown', copy.unknown],
          ['no_new_or_concerning_symptoms', '새롭거나 걱정되는 증상이 없음'],
          ['warning_signs', '아래 증상이 있음'],
        ]}
      />
      {draft.symptoms === 'warning_signs'
        ? signs.map(([sign, title]) => (
            <AppButton
              key={sign}
              title={title}
              accessibilityState={{ selected: draft.signs.includes(sign) }}
              onPress={() =>
                set(
                  'signs',
                  draft.signs.includes(sign)
                    ? draft.signs.filter(value => value !== sign)
                    : [...draft.signs, sign],
                )
              }
            />
          ))
        : null}
      <Choices
        label={copy.visit}
        selected={draft.upcomingVisit}
        onSelect={value => set('upcomingVisit', value)}
        values={[
          ['unknown', copy.unknown],
          ['yes', '예정된 진료가 있음'],
          ['no', '예정된 진료가 없음'],
        ]}
      />
      <Text accessibilityRole="header">{copy.reading}</Text>
      {draft.readings.map((row, index) => (
        <View key={index} style={styles.reading}>
          {(['systolic', 'diastolic', 'measuredAt', 'source'] as const).map(
            key => (
              <TextInput
                key={key}
                accessibilityLabel={`${copy[key]} ${index + 1}`}
                placeholder={copy[key]}
                value={row[key]}
                editable={!disabled}
                testID={`health-review-${key}-${index}`}
                autoCapitalize="none"
                onChangeText={value =>
                  set(
                    'readings',
                    draft.readings.map((entry, position) =>
                      position === index ? { ...entry, [key]: value } : entry,
                    ),
                  )
                }
              />
            ),
          )}
        </View>
      ))}
      {draft.readings.length < 2 ? (
        <AppButton
          title={copy.repeat}
          disabled={disabled}
          onPress={() =>
            set('readings', [...draft.readings, emptySafetyReading()])
          }
        />
      ) : null}
    </View>
  );
}
