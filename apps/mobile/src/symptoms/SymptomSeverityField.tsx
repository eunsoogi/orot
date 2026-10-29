import Slider from '@react-native-community/slider';
import { Button, Text, View } from 'react-native';
import { t } from '../i18n';
import TextInput from './SymptomTextInput';
import { formInputAccessoryID } from './symptomFormKeyboard';
import { appColors } from '../layout/appColors';
import styles from './SymptomForm.styles';

/** A visual zero thumb is not an answer: only interaction or explicit entry records severity. */
export default function SymptomSeverityField({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const selected = value !== '';
  const sliderValue = Number.isInteger(Number(value))
    ? Math.min(10, Math.max(0, Number(value)))
    : 0;
  return (
    <View style={styles.section}>
      <Text style={styles.fieldLabel}>
        {t('symptoms.journal.form.severity.title')}
      </Text>
      <Text style={styles.hint} testID="symptom-severity-selection">
        {selected
          ? `${value} / 10`
          : t('symptoms.journal.form.severity.missing')}
      </Text>
      {/* The package renders a 40pt iOS control; the 48pt host contains its vertical hit extension. */}
      <Slider
        accessibilityLabel={t('symptoms.journal.form.severity.label')}
        accessibilityValue={{
          min: 0,
          max: 10,
          now: selected ? sliderValue : undefined,
          text: selected
            ? `${value} / 10`
            : t('symptoms.journal.form.severity.missing'),
        }}
        hitSlop={{ top: 4, bottom: 4 }}
        minimumValue={0}
        maximumValue={10}
        step={1}
        value={sliderValue}
        onValueChange={next => onChange(String(next))}
        onSlidingComplete={next => onChange(String(next))}
        minimumTrackTintColor={appColors.primary}
        testID="symptom-severity-slider"
        style={styles.slider}
      />
      <Text style={styles.hint}>
        {t('symptoms.journal.form.severity.hint')}
      </Text>
      <TextInput
        accessibilityLabel={t('symptoms.journal.form.severity.label')}
        keyboardType="number-pad"
        onChangeText={onChange}
        inputAccessoryViewID={formInputAccessoryID('severity')}
        placeholder={t('symptoms.journal.form.severity.placeholder')}
        style={styles.input}
        testID="symptom-severity"
        value={value}
      />
      {selected ? (
        <Button
          title={t('symptoms.journal.form.severity.clear')}
          testID="symptom-severity-clear"
          onPress={() => onChange('')}
        />
      ) : null}
    </View>
  );
}
