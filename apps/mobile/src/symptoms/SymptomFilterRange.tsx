import { View } from 'react-native';
import { t } from '../i18n';
import TextInput from './SymptomTextInput';
import styles from './SymptomFilters.styles';

/** Both inclusive boundaries retain local date and time, including exact-minute ranges. */
export default function SymptomFilterRange({
  disabled,
  values,
  onChange,
  accessoryID,
}: {
  readonly disabled: boolean;
  readonly values: readonly string[];
  readonly onChange: readonly ((value: string) => void)[];
  readonly accessoryID: (index: number) => string | undefined;
}) {
  const fields = [
    ['from-date', 'symptoms.journal.dateFilter.startDate'],
    ['from-time', 'symptoms.journal.dateFilter.startTime'],
    ['through-date', 'symptoms.journal.dateFilter.endDate'],
    ['through-time', 'symptoms.journal.dateFilter.endTime'],
  ] as const;
  return (
    <View style={styles.row}>
      {fields.map(([id, label], index) => (
        <TextInput
          key={id}
          editable={!disabled}
          accessibilityLabel={t(label)}
          inputAccessoryViewID={accessoryID(index)}
          onChangeText={onChange[index]}
          placeholder={index % 2 === 0 ? 'YYYY-MM-DD' : 'HH:MM'}
          style={[styles.input, styles.halfInput]}
          testID={`symptom-filter-${id}`}
          value={values[index]}
        />
      ))}
    </View>
  );
}
