import { Pressable, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import type { HealthRecordsMedicationOption } from './healthRecordsMedicationDetailModel';
import {
  medicationSelectionStyles as styles,
  medicationHistoryStyles as history,
} from './healthRecordsMedicationDetailPanelStyles';

/** A virtualized option row shares the page's scroll owner with the selected history. */
export function HealthRecordsMedicationOptionRow({
  option,
  index,
  selected,
  onSelect,
}: {
  readonly option: HealthRecordsMedicationOption;
  readonly index: number;
  readonly selected: boolean;
  readonly onSelect: (id: string) => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={() => onSelect(option.id)}
      style={[styles.option, selected && styles.selectedOption]}
      testID={'health-record-medication-option-' + index}
    >
      <Text style={styles.optionTitle}>{option.name}</Text>
      {option.form ? (
        <Text style={styles.optionDetail}>
          {t('healthRecords.medicationForm', { form: option.form })}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** The section header names the exact saved medication without starting a second list. */
export function HealthRecordsMedicationHistoryHeader({
  selected,
}: {
  readonly selected: HealthRecordsMedicationOption | null;
}) {
  return (
    <View style={history.header}>
      <Text
        accessibilityRole="header"
        style={history.historyTitle}
        testID="health-records-medication-history-title"
      >
        {t('healthRecords.medicationHistory')}
      </Text>
      {selected ? (
        <View
          style={history.medicationSummary}
          testID="health-records-medication-selected"
        >
          <Text style={history.optionTitle}>{selected.name}</Text>
          {selected.form ? (
            <Text style={history.optionDetail}>
              {t('healthRecords.medicationForm', { form: selected.form })}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
