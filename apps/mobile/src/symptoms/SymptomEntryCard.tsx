import { Button, Pressable, StyleSheet, Text, View } from 'react-native';
import type { SymptomEntry } from '@orot/storage';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import { symptomDateTimeLabel, symptomStatusLabel } from './presentation';

type SymptomEntryCardProps = {
  entry: SymptomEntry;
  onEdit: () => void;
  onResolve: () => void;
  onSelect: () => void;
  selected?: boolean;
  disabled?: boolean;
};

export default function SymptomEntryCard({
  entry,
  onEdit,
  onResolve,
  onSelect,
  selected = false,
  disabled,
}: SymptomEntryCardProps) {
  const resolvedAt = entry.resolvedAt;
  const resolved = resolvedAt !== undefined;

  return (
    <View
      style={[styles.card, selected ? styles.selectedCard : undefined]}
      testID={`symptom-${entry.id}`}
    >
      {/* Keep the selector separate so details and Edit or Resolve stay accessible. */}
      <Pressable
        accessibilityHint={t('symptoms.journal.selectEntryHint')}
        accessibilityLabel={t(
          selected
            ? 'symptoms.journal.selectedEntry'
            : 'symptoms.journal.selectEntry',
          { description: entry.description },
        )}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        disabled={disabled}
        onPress={onSelect}
        style={styles.selectableDescription}
        testID={`symptom-select-${entry.id}`}
      >
        <Text
          style={styles.description}
          testID={`symptom-${entry.id}-description`}
        >
          {entry.description}
        </Text>
      </Pressable>
      <Text style={styles.detail} testID={`symptom-${entry.id}-onset`}>
        {t('symptoms.journal.startedAt', {
          dateTime: symptomDateTimeLabel(entry.effectiveAt),
        })}
      </Text>
      <Text style={styles.detail} testID={`symptom-${entry.id}-status`}>
        {symptomStatusLabel(entry.status)}
      </Text>
      <Text style={styles.detail}>{t('symptoms.journal.provenance')}</Text>
      {entry.bodySite ? (
        <Text style={styles.detail}>{entry.bodySite}</Text>
      ) : null}
      {entry.severity !== undefined ? (
        <Text style={styles.detail} testID={`symptom-${entry.id}-severity`}>
          {t('symptoms.journal.severity', { severity: entry.severity })}
        </Text>
      ) : null}
      {resolved && resolvedAt ? (
        <Text style={styles.detail}>
          {t('symptoms.journal.resolvedAt', {
            dateTime: symptomDateTimeLabel(resolvedAt),
          })}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button
          disabled={disabled}
          onPress={onEdit}
          testID={`symptom-edit-${entry.id}`}
          title={t('symptoms.journal.edit')}
        />
        {entry.status === 'active' ? (
          <Button
            disabled={disabled}
            onPress={onResolve}
            testID={`symptom-resolve-${entry.id}`}
            title={t('symptoms.journal.markResolved')}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  selectedCard: {
    backgroundColor: appColors.primarySoft,
    borderColor: appColors.primaryText,
  },
  selectableDescription: { borderRadius: 8, minHeight: 44 },
  description: { color: appColors.text, fontSize: 18, fontWeight: '600' },
  detail: { color: appColors.text },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    gap: 16,
  },
});
