import type { SymptomEntry } from '@orot/storage';
import { Text, View } from 'react-native';
import { t } from '../i18n';
import { symptomDateTimeLabel, symptomStatusLabel } from './presentation';
import styles from './SymptomForm.styles';

/** Editing corrects report details; onset and resolution history keep their original domain meaning. */
export default function SymptomEditContext({
  entry,
}: {
  readonly entry: SymptomEntry;
}) {
  return (
    <View style={styles.section} testID="symptom-edit-context">
      <Text style={styles.fieldLabel}>
        {t('symptoms.journal.form.onset.title')}
      </Text>
      <Text style={styles.choiceLabel}>
        {symptomDateTimeLabel(entry.effectiveAt)}
      </Text>
      <Text style={styles.fieldLabel}>
        {t('symptoms.journal.form.status.title')}
      </Text>
      <Text style={styles.choiceLabel}>{symptomStatusLabel(entry.status)}</Text>
      {entry.resolvedAt ? (
        <Text style={styles.choiceLabel}>
          {t('symptoms.journal.resolvedAt', {
            dateTime: symptomDateTimeLabel(entry.resolvedAt),
          })}
        </Text>
      ) : null}
    </View>
  );
}
