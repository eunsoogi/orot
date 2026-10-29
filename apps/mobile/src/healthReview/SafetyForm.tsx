import { useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { MeasurementFields } from './MeasurementFields';
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
  disabled,
  wide,
  testID,
}: {
  label: string;
  values: readonly (readonly [T, string])[];
  selected: T;
  onSelect: (value: T) => void;
  disabled: boolean;
  wide: boolean;
  testID: string;
}) {
  return (
    <View>
      <Text accessibilityRole="header">{label}</Text>
      <View testID={testID} style={wide ? styles.choiceRow : styles.column}>
        {values.map(([value, title]) => (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityLabel={`${label}: ${title}`}
            accessibilityState={{
              checked: selected === value,
              selected: selected === value,
              disabled,
            }}
            disabled={disabled}
            style={[
              styles.choice,
              wide && styles.choiceWide,
              selected === value && styles.choiceSelected,
            ]}
            onPress={() => onSelect(value)}
          >
            <View
              style={[
                styles.choiceMark,
                selected === value && styles.choiceMarkSelected,
              ]}
            />
            <Text style={styles.choiceLabel}>{title}</Text>
          </Pressable>
        ))}
      </View>
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
  const [width, setWidth] = useState(0);
  const { fontScale } = useWindowDimensions();
  // Use the actual content lane, since a wide window may be split by the system.
  const wide = width / Math.max(1, fontScale) >= 720;
  const set = <K extends keyof HealthReviewSafetyDraft>(
    key: K,
    value: HealthReviewSafetyDraft[K],
  ) => {
    if (!disabled) onChange({ ...draft, [key]: value });
  };
  return (
    <View
      style={styles.form}
      testID="health-review-form"
      onLayout={event => setWidth(event.nativeEvent.layout.width)}
    >
      <Choices
        label={copy.population}
        testID="health-review-population-choices"
        wide={wide}
        disabled={disabled}
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
        testID="health-review-context-choices"
        wide={wide}
        disabled={disabled}
        selected={draft.readingContext}
        onSelect={value => set('readingContext', value)}
        values={[
          ['unknown', copy.unknown],
          ['current_measurement', '현재 측정'],
          ['historical', '과거 측정'],
        ]}
      />
      <Text accessibilityRole="header">{copy.reading}</Text>
      {draft.readings.map((row, index) => (
        <MeasurementFields
          key={index}
          row={row}
          index={index}
          disabled={disabled}
          wide={wide}
          onChange={value =>
            set(
              'readings',
              draft.readings.map((entry, position) =>
                position === index ? value : entry,
              ),
            )
          }
        />
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
      <Choices
        label={copy.symptoms}
        testID="health-review-symptom-choices"
        wide={wide}
        disabled={disabled}
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
              disabled={disabled}
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
        testID="health-review-visit-choices"
        wide={wide}
        disabled={disabled}
        selected={draft.upcomingVisit}
        onSelect={value => set('upcomingVisit', value)}
        values={[
          ['unknown', copy.unknown],
          ['yes', '예정된 진료가 있음'],
          ['no', '예정된 진료가 없음'],
        ]}
      />
    </View>
  );
}
