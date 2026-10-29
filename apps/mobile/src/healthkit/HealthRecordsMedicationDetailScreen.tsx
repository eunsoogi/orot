import { useCallback, useMemo, useState } from 'react';
import { SectionList, View } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { useNavigationLeaveStateRegistration } from '../navigation';
import type { NavigationLeaveState } from '../navigation';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import type { HealthRecordsDetailSelection } from './healthRecordsLibraryModel';
import { HealthRecordsDetailHeader } from './HealthRecordsDetailHeader';
import { HealthRecordsMedicationRecordRow } from './HealthRecordsMedicationRecordRow';
import {
  HealthRecordsMedicationHistoryHeader,
  HealthRecordsMedicationOptionRow,
} from './HealthRecordsMedicationSection';
import type {
  HealthRecordsMedicationOption,
  HealthRecordsMedicationDetailRow,
} from './healthRecordsMedicationDetailModel';
import { healthRecordsDetailStyles as styles } from './HealthRecordsDetailScreen.styles';
import { buildHealthRecordsMedicationOptions } from './healthRecordsMedicationDetailModel';
import type { HealthRecordsMedicationLoader } from './healthRecordsMedicationLibrary';
import { useHealthRecordsMedicationDetailData } from './useHealthRecordsMedicationDetailData';

interface HealthRecordsMedicationDetailScreenProps {
  readonly loadMedicationData?: HealthRecordsMedicationLoader;
  readonly onBack: () => void;
  readonly onSelectionChange: (selection: HealthRecordsDetailSelection) => void;
  readonly selection: HealthRecordsDetailSelection;
}

type MedicationItem =
  | { readonly kind: 'option'; readonly value: HealthRecordsMedicationOption }
  | {
      readonly kind: 'history';
      readonly value: HealthRecordsMedicationDetailRow;
    };

/** A single SectionList virtualizes both medication choices and saved-event history. */
export function HealthRecordsMedicationDetailScreen({
  loadMedicationData,
  onBack,
  onSelectionChange,
  selection,
}: HealthRecordsMedicationDetailScreenProps) {
  const navigationInset = useNavigationContentInset();
  const { cursor, data, loadState, reload, revision, rows } =
    useHealthRecordsMedicationDetailData(selection.period, loadMedicationData);
  const [selectedMedicationId, setSelectedMedicationId] = useState<
    string | null
  >(null);
  const options = useMemo(
    () => buildHealthRecordsMedicationOptions(data, rows),
    [data, rows],
  );
  const selectedMedication =
    options.find(option => option.id === selectedMedicationId) ??
    options[0] ??
    null;
  const selectedRows = useMemo(
    () =>
      selectedMedication
        ? rows.filter(
            row =>
              row.doseEvent.medicationDefinitionId === selectedMedication.id,
          )
        : [],
    [rows, selectedMedication],
  );
  const hasSharedNavigation = useNavigationLeaveStateRegistration({
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision,
    inputRevision: 0,
  } satisfies NavigationLeaveState);
  const onRetry = useCallback(() => reload(cursor), [cursor, reload]);
  const onLoadMore = useCallback(() => {
    if (cursor && loadState === 'ready') {
      reload(cursor).catch(() => undefined);
    }
  }, [cursor, loadState, reload]);

  const sections: { key: string; data: MedicationItem[] }[] = [
    { key: 'options', data: options.map(value => ({ kind: 'option', value })) },
    {
      key: 'history',
      data: selectedRows.map(value => ({ kind: 'history', value })),
    },
  ];
  // Selection and paging stay on the route while sections share one vertical owner.
  return (
    <AdaptiveColumns
      primary={
        <SectionList
          sections={sections}
          stickySectionHeadersEnabled={false}
          keyExtractor={item =>
            item.kind === 'option'
              ? 'option-' + item.value.id
              : 'dose-' + item.value.doseEvent.id
          }
          contentContainerStyle={[styles.container, navigationInset]}
          ListHeaderComponent={
            <HealthRecordsDetailHeader
              title="약 및 복용 기록 상세"
              hasSharedNavigation={hasSharedNavigation}
              loadState={loadState}
              onBack={onBack}
              onRetry={onRetry}
              onSelectionChange={onSelectionChange}
              recordCount={rows.length}
              observationCount={rows.length}
              hasMore={cursor !== null}
              selection={selection}
            />
          }
          renderItem={({ item, index }) =>
            item.kind === 'option' ? (
              <HealthRecordsMedicationOptionRow
                option={item.value}
                index={index}
                selected={item.value.id === selectedMedication?.id}
                onSelect={setSelectedMedicationId}
              />
            ) : (
              <HealthRecordsMedicationRecordRow
                index={index}
                row={item.value}
              />
            )
          }
          renderSectionHeader={({ section }) =>
            section.key === 'history' ? (
              <HealthRecordsMedicationHistoryHeader
                selected={selectedMedication}
              />
            ) : null
          }
          renderSectionFooter={({ section }) =>
            section.key === 'options' &&
            options.length === 0 &&
            !cursor &&
            loadState === 'ready' ? (
              <Text testID="health-records-detail-empty">
                {t('healthRecords.detailEmpty')}
              </Text>
            ) : section.key === 'history' &&
              selectedMedication !== null &&
              selectedRows.length === 0 &&
              loadState === 'ready' ? (
              // Pages are globally time-ordered; an absent selected medication is
              // only genuinely empty once the storage cursor is exhausted.
              <Text
                testID={
                  cursor
                    ? 'health-records-medication-history-pending'
                    : 'health-records-medication-history-empty'
                }
              >
                {t(
                  cursor
                    ? 'healthRecords.moreAvailable'
                    : 'healthRecords.detailEmpty',
                )}
              </Text>
            ) : null
          }
          ListFooterComponent={
            cursor ? (
              loadState === 'loading' ? (
                <Text testID="health-records-detail-loading">
                  {t('healthRecords.loading')}
                </Text>
              ) : (
                <View style={styles.header}>
                  {loadState === 'failed' ? (
                    <Text
                      accessibilityRole="alert"
                      style={styles.error}
                      testID="health-records-detail-error"
                    >
                      {t('healthRecords.error')}
                    </Text>
                  ) : null}
                  <AppButton
                    onPress={loadState === 'failed' ? onRetry : onLoadMore}
                    testID={
                      loadState === 'failed'
                        ? 'health-records-detail-retry'
                        : 'health-records-detail-more'
                    }
                    title={t(
                      loadState === 'failed'
                        ? 'healthRecords.retry'
                        : 'healthRecords.loadOlder',
                    )}
                    variant="secondary"
                  />
                </View>
              )
            ) : undefined
          }
          onEndReached={onLoadMore}
          onEndReachedThreshold={0.5}
          style={styles.panelScroll}
          testID="health-records-detail-scroll"
        />
      }
      routeKey="health-records-medication-detail"
      testID="health-records-medication-detail-layout"
    />
  );
}
