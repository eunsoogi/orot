import { FlatList, Pressable, View } from 'react-native';
import type { ViewStyle } from 'react-native';
import type { HealthObservationCursor } from '@orot/storage';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { navigationText } from '../i18n/navigation';
import type { HealthRecordsDetailSelection } from './healthRecordsLibraryModel';
import {
  healthRecordCategoryTitle,
  healthRecordPeriodTitle,
} from './healthRecordsLibraryModel';
import { healthRecordPeriods } from './healthRecordsDetailModel';
import type { HealthRecordsMedicationDetailLoadState } from './useHealthRecordsMedicationDetailData';
import type { HealthRecordsMedicationOption } from './healthRecordsMedicationDetailModel';
import { medicationSelectionStyles as styles } from './healthRecordsMedicationDetailPanelStyles';

/** Keeps period controls and medication selection together in the route-owned panel. */
export function HealthRecordsMedicationSelectionPanel({
  cursor,
  hasSharedNavigation,
  loadState,
  navigationInset,
  onBack,
  onRetry,
  onSelectMedication,
  onSelectionChange,
  options,
  selectedMedicationId,
  selection,
  rowCount,
}: {
  readonly cursor: HealthObservationCursor | null;
  readonly hasSharedNavigation: boolean;
  readonly loadState: HealthRecordsMedicationDetailLoadState;
  readonly navigationInset: ViewStyle;
  readonly onBack: () => void;
  readonly onRetry: () => void;
  readonly onSelectMedication: (id: string) => void;
  readonly onSelectionChange: (selection: HealthRecordsDetailSelection) => void;
  readonly options: readonly HealthRecordsMedicationOption[];
  readonly selectedMedicationId: string | null;
  readonly selection: HealthRecordsDetailSelection;
  readonly rowCount: number;
}) {
  return (
    <FlatList
      contentContainerStyle={[styles.content, navigationInset]}
      data={options}
      keyExtractor={option => option.id}
      ListEmptyComponent={
        loadState === 'ready' ? (
          <Text testID="health-records-detail-empty">
            {t('healthRecords.detailEmpty')}
          </Text>
        ) : undefined
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <Text
              accessibilityRole="header"
              style={styles.title}
              testID="health-records-detail-title"
            >
              {healthRecordCategoryTitle('medications') + ' 기록 상세'}
            </Text>
            {hasSharedNavigation ? null : (
              <AppButton
                accessibilityLabel={navigationText.back.accessibilityLabel}
                onPress={onBack}
                testID="health-records-detail-back"
                title={navigationText.back.label}
                variant="secondary"
              />
            )}
          </View>
          <Text style={styles.description}>
            {t('healthRecords.detailDescription')}
          </Text>
          <View accessibilityRole="radiogroup" style={styles.periods}>
            {healthRecordPeriods.map(period => (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ selected: selection.period === period }}
                key={period}
                onPress={() => onSelectionChange({ ...selection, period })}
                style={[
                  styles.period,
                  selection.period === period && styles.selectedPeriod,
                ]}
                testID={'health-record-period-' + period}
              >
                <Text
                  style={[
                    styles.periodText,
                    selection.period === period && styles.selectedPeriodText,
                  ]}
                >
                  {healthRecordPeriodTitle(period)}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.count}>
            {t(
              cursor
                ? 'healthRecords.loadedRecordCount'
                : 'healthRecords.recordCount',
              { count: rowCount },
            )}
          </Text>
          {loadState === 'loading' ? (
            <Text testID="health-records-detail-loading">
              {t('healthRecords.loading')}
            </Text>
          ) : null}
          {loadState === 'failed' ? (
            <View>
              <Text accessibilityRole="alert" style={styles.error}>
                {t('healthRecords.error')}
              </Text>
              <AppButton
                onPress={onRetry}
                testID="health-records-detail-retry"
                title={t('healthRecords.retry')}
                variant="secondary"
              />
            </View>
          ) : null}
        </View>
      }
      renderItem={({ item, index }) => (
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ selected: item.id === selectedMedicationId }}
          onPress={() => onSelectMedication(item.id)}
          style={[
            styles.option,
            item.id === selectedMedicationId && styles.selectedOption,
          ]}
          testID={'health-record-medication-option-' + index}
        >
          <Text style={styles.optionTitle}>{item.name}</Text>
          {item.form ? (
            <Text style={styles.optionDetail}>
              {t('healthRecords.medicationForm', { form: item.form })}
            </Text>
          ) : null}
        </Pressable>
      )}
      style={styles.scroll}
      testID="health-records-medication-options"
    />
  );
}
