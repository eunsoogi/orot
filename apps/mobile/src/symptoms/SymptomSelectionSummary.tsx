import { StyleSheet, Text, View } from 'react-native';
import type { SymptomEntry } from '@orot/storage';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import { symptomDateTimeLabel, symptomStatusLabel } from './presentation';

/** Presents a selected entry's unchanged user text with localized status and time. */
export default function SymptomSelectionSummary({
  entry,
}: {
  readonly entry: SymptomEntry | null;
}) {
  const resolvedAt = entry?.resolvedAt;

  return (
    <View style={styles.panel} testID="symptoms-selected-summary">
      <Text accessibilityRole="header" style={styles.title}>
        {t('symptoms.journal.selection.title')}
      </Text>
      {entry ? (
        <>
          <Text
            style={styles.description}
            testID="symptoms-selected-description"
          >
            {entry.description}
          </Text>
          <Text style={styles.detail} testID="symptoms-selected-onset">
            {t('symptoms.journal.startedAt', {
              dateTime: symptomDateTimeLabel(entry.effectiveAt),
            })}
          </Text>
          <Text style={styles.detail} testID="symptoms-selected-status">
            {symptomStatusLabel(entry.status)}
          </Text>
          <Text style={styles.detail}>{t('symptoms.journal.provenance')}</Text>
          {entry.bodySite ? (
            <Text style={styles.detail}>{entry.bodySite}</Text>
          ) : null}
          {entry.severity !== undefined ? (
            <Text style={styles.detail} testID="symptoms-selected-severity">
              {t('symptoms.journal.severity', { severity: entry.severity })}
            </Text>
          ) : null}
          {resolvedAt ? (
            <Text style={styles.detail}>
              {t('symptoms.journal.resolvedAt', {
                dateTime: symptomDateTimeLabel(resolvedAt),
              })}
            </Text>
          ) : null}
        </>
      ) : (
        <Text style={styles.empty} testID="symptoms-selection-empty">
          {t('symptoms.journal.selection.empty')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
    minWidth: 0,
    padding: 18,
  },
  title: { color: appColors.text, fontSize: 18, fontWeight: '700' },
  description: { color: appColors.text, fontSize: 20, fontWeight: '600' },
  detail: { color: appColors.text },
  empty: { color: appColors.secondary, fontSize: 15 },
});
