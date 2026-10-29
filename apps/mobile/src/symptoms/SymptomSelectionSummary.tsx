import { StyleSheet, Text, View } from 'react-native';
import type { SymptomEntry } from '@orot/storage';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import { symptomDateTimeLabel } from './presentation';

/** Inline detail preserves explicit zero and missing severity without duplicating the card heading. */
export default function SymptomSelectionSummary({
  entry,
}: {
  readonly entry: SymptomEntry;
}) {
  const resolvedAt = entry.resolvedAt;

  return (
    <View style={styles.panel} testID="symptoms-selected-summary">
      <Text style={styles.detail}>{t('symptoms.journal.provenance')}</Text>
      {entry.bodySite ? (
        <Text style={styles.detail}>
          {t('symptoms.journal.bodySite', { bodySite: entry.bodySite })}
        </Text>
      ) : null}
      {entry.severity !== undefined ? (
        <Text style={styles.detail} testID={`symptom-${entry.id}-severity`}>
          {t('symptoms.journal.severity', { severity: entry.severity })}
        </Text>
      ) : (
        <Text
          style={styles.detail}
          testID={`symptom-${entry.id}-severity-missing`}
        >
          {t('symptoms.journal.form.severity.missing')}
        </Text>
      )}
      {resolvedAt ? (
        <Text style={styles.detail}>
          {t('symptoms.journal.resolvedAt', {
            dateTime: symptomDateTimeLabel(resolvedAt),
          })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderTopWidth: 1,
    borderColor: appColors.border,
    gap: 12,
    paddingTop: 16,
  },
  detail: { color: appColors.text },
});
