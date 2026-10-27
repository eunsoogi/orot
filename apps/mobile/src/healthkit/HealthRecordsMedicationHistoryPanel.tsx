import { FlatList, View } from 'react-native';
import type { ViewStyle } from 'react-native';
import type { HealthObservationCursor } from '@orot/storage';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import type { HealthRecordsMedicationDetailLoadState } from './useHealthRecordsMedicationDetailData';
import type {
  HealthRecordsMedicationDetailRow,
  HealthRecordsMedicationOption,
} from './healthRecordsMedicationDetailModel';
import { HealthRecordsMedicationRecordRow } from './HealthRecordsMedicationRecordRow';
import { medicationHistoryStyles as styles } from './healthRecordsMedicationDetailPanelStyles';

/** Shows one medication's loaded dose events and keeps pagination inside that history panel. */
export function HealthRecordsMedicationHistoryPanel({
  cursor,
  loadState,
  navigationInset,
  onLoadMore,
  rows,
  selectedMedication,
}: {
  readonly cursor: HealthObservationCursor | null;
  readonly loadState: HealthRecordsMedicationDetailLoadState;
  readonly navigationInset: ViewStyle;
  readonly onLoadMore: () => void;
  readonly rows: readonly HealthRecordsMedicationDetailRow[];
  readonly selectedMedication: HealthRecordsMedicationOption | null;
}) {
  return (
    <FlatList
      contentContainerStyle={[styles.content, navigationInset]}
      data={rows}
      keyExtractor={row => row.doseEvent.id}
      ListEmptyComponent={
        selectedMedication && loadState === 'ready' ? (
          <Text testID="health-records-medication-history-empty">
            {t('healthRecords.detailEmpty')}
          </Text>
        ) : undefined
      }
      ListFooterComponent={
        cursor ? (
          <AppButton
            onPress={onLoadMore}
            testID="health-records-detail-more"
            title={t('healthRecords.loadOlder')}
            variant="secondary"
          />
        ) : undefined
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <Text
            accessibilityRole="header"
            style={styles.historyTitle}
            testID="health-records-medication-history-title"
          >
            {t('healthRecords.medicationHistory')}
          </Text>
          {selectedMedication ? (
            <View
              style={styles.medicationSummary}
              testID="health-records-medication-selected"
            >
              <Text style={styles.optionTitle}>{selectedMedication.name}</Text>
              {selectedMedication.form ? (
                <Text style={styles.optionDetail}>
                  {t('healthRecords.medicationForm', {
                    form: selectedMedication.form,
                  })}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      }
      onEndReached={cursor && loadState === 'ready' ? onLoadMore : undefined}
      onEndReachedThreshold={0.5}
      renderItem={({ item, index }) => (
        <HealthRecordsMedicationRecordRow index={index} row={item} />
      )}
      style={styles.scroll}
      testID="health-records-detail-scroll"
    />
  );
}
