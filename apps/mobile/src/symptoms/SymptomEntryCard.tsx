import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SymptomEntry } from '@orot/storage';
import { AppButton as Button } from '../layout/AppButton';
import SymptomSelectionSummary from './SymptomSelectionSummary';
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
  resolutionFailed?: boolean;
};

export default function SymptomEntryCard({
  entry,
  onEdit,
  onResolve,
  onSelect,
  selected = false,
  disabled,
  resolutionFailed = false,
}: SymptomEntryCardProps) {
  return (
    <View
      style={[styles.card, selected ? styles.selectedCard : undefined]}
      testID={`symptom-${entry.id}`}
    >
      {/* Only this header is selectable; expanded detail and actions remain separate AX elements. */}
      <Pressable
        accessibilityHint={t('symptoms.journal.selectEntryHint')}
        accessibilityLabel={t(
          selected
            ? 'symptoms.journal.selectedEntry'
            : 'symptoms.journal.selectEntry',
          { description: entry.description },
        )}
        accessibilityRole="button"
        accessibilityState={{ selected, expanded: selected }}
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
      <Text
        style={[
          styles.detail,
          styles.status,
          entry.status === 'active'
            ? styles.activeStatus
            : styles.resolvedStatus,
        ]}
        testID={`symptom-${entry.id}-status`}
      >
        {symptomStatusLabel(entry.status)}
      </Text>
      {selected ? (
        <>
          <SymptomSelectionSummary entry={entry} />
          <View style={styles.actions}>
            <Button
              disabled={disabled}
              onPress={onEdit}
              testID={`symptom-edit-${entry.id}`}
              title={t('symptoms.journal.edit')}
              variant="secondary"
            />
            {entry.status === 'active' ? (
              <Button
                disabled={disabled}
                onPress={onResolve}
                testID={`symptom-resolve-${entry.id}`}
                title={t(
                  resolutionFailed
                    ? 'symptoms.journal.retry'
                    : 'symptoms.journal.markResolved',
                )}
              />
            ) : null}
          </View>
        </>
      ) : null}
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
  status: {
    alignSelf: 'flex-start',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  activeStatus: {
    backgroundColor: appColors.warningSurface,
    color: appColors.warning,
  },
  resolvedStatus: {
    backgroundColor: appColors.greenSoft,
    color: appColors.green,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    gap: 16,
  },
});
