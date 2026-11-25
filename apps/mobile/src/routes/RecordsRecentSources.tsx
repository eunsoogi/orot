import { useLayoutEffect } from 'react';
import { useRecentRecordsSuspension } from './useRecentRecordsSuspension';
import { StyleSheet, View } from 'react-native';
import type { MedicalDocumentSourceRecord } from '../medicalDocuments/medicalDocumentImportService';
import type { RecordingSourceRecord } from '../recording/recordingTypes';
import { AppText as Text } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import { RecordsRecentSourceEntry } from './RecordsRecentSourceEntry';
import { RecordsRecentSourceState } from './RecordsRecentSourceState';
import type { RecentMaterialReadyLease } from '../generatedReports/certifiedRecentMaterialPage';
import type { GeneratedReportRow } from '../generatedReports/types';
import type { NavigationRouteOwnership } from '../navigation/navigationRouteContracts';
import type { RecordsTabAuthority } from './useAppRootTab';
import { useRecordsRecentFeed } from './useRecordsRecentFeed';
import { hubSpacing } from '../layout/hubSpacing';

export interface RecordsRecentSourcesProps {
  readonly showAll?: boolean;
  readonly pagedAudio?: boolean;
  readonly pagedDocuments?: boolean;
  readonly onViewAll?: () => void;
  readonly recordings: readonly RecordingSourceRecord[];
  readonly recordingState: 'loading' | 'ready' | 'failed';
  readonly documents: readonly MedicalDocumentSourceRecord[];
  readonly documentsState: 'loading' | 'ready' | 'failed';
  readonly documentsError: string | null;
  readonly documentsOpening: boolean;
  readonly onRetryRecordings: () => void;
  readonly onRetryDocuments: () => void;
  readonly onOpenMedicalDocument: (sourceId: string) => void;
  readonly onOpenSavedRecordings: () => void;
  readonly onOpenRecording?: (source: RecordingSourceRecord) => void;
  readonly onOpenMemory?: (id: string) => void;
  readonly onOpenReport?: (row: GeneratedReportRow) => boolean;
  readonly active?: boolean;
  readonly ownership?: NavigationRouteOwnership;
  readonly tabAuthority?: RecordsTabAuthority;
  readonly recentMaterialReadyLease?: RecentMaterialReadyLease;
}

/** Renders actual local activity in one grouped timeline while preserving each existing destination. */
export function RecordsRecentSources(props: RecordsRecentSourcesProps) {
  const { showAll = false, onViewAll, documents, documentsOpening } = props;
  const suspension = useRecentRecordsSuspension(
    props.active ?? true,
    props.ownership,
    props.tabAuthority,
  );
  const {
    records,
    groups,
    showMore,
    retrySources,
    openRecord,
    isCurrent,
    more,
    isLoading,
    isFresh,
    canAdvance,
    loadErrors,
  } = useRecordsRecentFeed(props);
  useLayoutEffect(() => {
    suspension.update(
      isFresh && !isLoading,
      loadErrors.length > 0,
      records.length > 0,
    );
  });
  if (suspension.hidden) return null;
  // A source failure must not add an error banner to records that are already usable.
  const hasRecords = records.length > 0;
  const statusAtTail = hasRecords && showAll;
  const status = (
    <>
      {isLoading ? (
        <RecordsRecentSourceState state="loading" onRetry={retrySources} />
      ) : null}
      {!hasRecords && loadErrors.length > 0 ? (
        <RecordsRecentSourceState
          state="failed"
          errorMessage={loadErrors.join('\n')}
          onRetry={retrySources}
        />
      ) : null}
    </>
  );

  return (
    <View style={styles.container} testID="records-recent-sources">
      <View style={styles.headingRow}>
        <Text accessibilityRole="header" style={styles.heading}>
          {t('overview.recentRecord')}
        </Text>
        {!showAll && records.length > 0 && onViewAll ? (
          <AppButton
            accessibilityLabel={t('records.recent.viewAll')}
            onPress={() => isCurrent() && onViewAll()}
            size="compact"
            testID="records-recent-view-all"
            title={t('records.recent.viewAll') + '  ›'}
            variant="text"
          />
        ) : null}
      </View>
      {!statusAtTail ? status : null}
      {!isLoading && loadErrors.length === 0 && records.length === 0 ? (
        <RecordsRecentSourceState
          state="empty"
          showDocumentLibraryEmpty={documents.length === 0}
          onRetry={retrySources}
        />
      ) : null}
      {records.length > 0 ? (
        <View style={styles.groups}>
          {groups.map(group => (
            <View
              key={group.key}
              style={styles.group}
              testID={`records-recent-group-${group.key}`}
            >
              <View style={styles.groupHeadingRow}>
                <Text accessibilityRole="header" style={styles.groupHeading}>
                  {group.label}
                </Text>
                <View style={styles.groupDivider} />
              </View>
              <View style={styles.rows}>
                <View pointerEvents="none" style={styles.timelineLine} />
                {group.records.map(record => (
                  <RecordsRecentSourceEntry
                    key={`${record.kind}:${record.id}`}
                    documentIndex={record.documentIndex}
                    documentsOpening={documentsOpening}
                    groupLabel={group.label}
                    onOpen={() => openRecord(record)}
                    record={record}
                  />
                ))}
              </View>
            </View>
          ))}
        </View>
      ) : null}
      {showAll && more ? (
        <AppButton
          testID="records-recent-show-more"
          title={t('records.recent.showMore')}
          disabled={!canAdvance}
          onPress={showMore}
        />
      ) : null}
      {statusAtTail ? status : null}
      {documentsOpening ? (
        <Text accessibilityLiveRegion="polite">
          {t('medicalDocument.source.opening')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: hubSpacing.item, minWidth: 0 },
  headingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minWidth: 0,
  },
  heading: { color: appColors.text, fontSize: 21, fontWeight: '700' },
  groups: { gap: hubSpacing.item },
  group: { gap: 4, minWidth: 0 },
  groupHeadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  groupHeading: { color: appColors.secondary, fontSize: 14, fontWeight: '600' },
  groupDivider: {
    backgroundColor: appColors.border,
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  rows: { gap: hubSpacing.item, minWidth: 0, position: 'relative' },
  timelineLine: {
    backgroundColor: appColors.border,
    bottom: 10,
    left: 5,
    position: 'absolute',
    top: 10,
    width: StyleSheet.hairlineWidth,
  },
});
