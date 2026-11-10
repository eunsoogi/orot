import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import type { SafetyPolicyInput } from '@orot/domain';
import { t } from '../i18n';
import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';

const populations = [
  ['adult_not_pregnant', 'treatmentSafety.adult'],
  ['pregnant', 'treatmentSafety.pregnant'],
  ['child', 'treatmentSafety.child'],
  ['unknown', 'treatmentSafety.unknown'],
] as const;
const symptoms = [
  ['no_new_or_concerning_symptoms', 'treatmentSafety.none'],
  ['unknown', 'treatmentSafety.unknown'],
  ['chest_pain', 'treatmentSafety.chestPain'],
  ['shortness_of_breath', 'treatmentSafety.breathing'],
  ['back_pain', 'treatmentSafety.backPain'],
  ['numbness', 'treatmentSafety.numbness'],
  ['weakness', 'treatmentSafety.weakness'],
  ['vision_change', 'treatmentSafety.vision'],
  ['difficulty_speaking', 'treatmentSafety.speech'],
] as const;

function pressure(value: string) {
  return /^\d+(?:[.,]\d+)?$/.test(value.trim())
    ? Number(value.replace(',', '.'))
    : NaN;
}

/** Raw measurements and choices live only while this form is mounted. */
export function TreatmentSafetyForm({
  onSubmit,
  allowSave,
  disabled,
}: {
  readonly onSubmit: (
    input: SafetyPolicyInput,
    skip: boolean,
    save?: boolean,
  ) => void;
  readonly allowSave?: boolean;
  readonly disabled?: boolean;
}) {
  const [systolic, setSystolic] = useState('');
  const [diastolic, setDiastolic] = useState('');
  const [population, setPopulation] =
    useState<SafetyPolicyInput['population']>();
  const [symptom, setSymptom] = useState<(typeof symptoms)[number][0]>();
  const submit = (skip: boolean, save?: boolean) => {
    // Only this explicitly current, user-entered reading can enter the policy.
    onSubmit(
      {
        population,
        ...(systolic.trim() || diastolic.trim()
          ? {
              readingContext: 'current_measurement',
              readings: [
                {
                  systolicMmHg: pressure(systolic),
                  diastolicMmHg: pressure(diastolic),
                  unit: 'mmHg',
                  measuredAt: new Date().toISOString(),
                  source: 'user_entered_current_measurement',
                },
              ],
            }
          : {}),
        symptomAssessment:
          !symptom ||
          symptom === 'unknown' ||
          symptom === 'no_new_or_concerning_symptoms'
            ? { status: symptom ?? 'unknown' }
            : { status: 'warning_signs', signs: [symptom] },
      },
      skip,
      save,
    );
  };
  return (
    <View style={styles.group}>
      <AppText>{t('treatmentSafety.privateInput')}</AppText>
      <AppText accessibilityRole="header">
        {t('treatmentSafety.population')}
      </AppText>
      {populations.map(([value, key]) => (
        <AppButton
          key={value}
          title={t(key)}
          variant={population === value ? 'primary' : 'neutral'}
          accessibilityState={{ selected: population === value }}
          disabled={disabled}
          onPress={() => setPopulation(value)}
        />
      ))}
      <AppText accessibilityRole="header">
        {t('treatmentSafety.currentReading')}
      </AppText>
      <TextInput
        accessibilityLabel={t('treatmentSafety.systolic')}
        placeholder={t('treatmentSafety.systolic')}
        placeholderTextColor={appColors.secondary}
        style={styles.input}
        keyboardType="decimal-pad"
        editable={!disabled}
        value={systolic}
        onChangeText={setSystolic}
      />
      <TextInput
        accessibilityLabel={t('treatmentSafety.diastolic')}
        placeholder={t('treatmentSafety.diastolic')}
        placeholderTextColor={appColors.secondary}
        style={styles.input}
        keyboardType="decimal-pad"
        editable={!disabled}
        value={diastolic}
        onChangeText={setDiastolic}
      />
      <AppText accessibilityRole="header">
        {t('treatmentSafety.symptoms')}
      </AppText>
      {symptoms.map(([value, key]) => (
        <AppButton
          key={value}
          title={t(key)}
          accessibilityLabel={
            value === 'unknown'
              ? `${t('treatmentSafety.symptoms')}, ${t(key)}`
              : t(key)
          }
          variant={symptom === value ? 'primary' : 'neutral'}
          accessibilityState={{ selected: symptom === value }}
          disabled={disabled}
          onPress={() => setSymptom(value)}
        />
      ))}
      <AppButton
        title={t('treatmentSafety.confirm')}
        disabled={disabled}
        onPress={() => submit(false)}
      />
      {allowSave ? (
        <AppButton
          variant="secondary"
          title={t('treatmentSafety.saveAndConfirm')}
          disabled={disabled}
          onPress={() => submit(false, true)}
        />
      ) : null}
      <AppButton
        variant="secondary"
        title={t('treatmentSafety.skip')}
        disabled={disabled}
        onPress={() => submit(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  input: {
    color: appColors.text,
    backgroundColor: appColors.background,
    padding: 12,
    borderRadius: 8,
    minHeight: 44,
  },
});
