import { useLayoutEffect, useState } from 'react';
import {
  RecordsSnapshotSurface,
  hasRecordsNativeSnapshotSurface,
} from './RecordsSnapshotSurface';
import { useRecentRecordsSuspension } from './useRecentRecordsSuspension';
import { StyleSheet, View } from 'react-native';
import type { MedicalDocumentSourceRecord } from '../medicalDocuments/medicalDocumentImportService';
import type { RecordingSourceRecord } from '../recording/recordingTypes';
import { AppText as Text } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import { RecordsRecentSourceEntry } from './RecordsRecentSourceEntry';
import { RecordsRecentSkeleton } from './RecordsRecentSkeleton';
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
  const [shieldBound, setShieldBound] = useState(false);
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
    retryProtectedPaint,
    openRecord,
    isCurrent,
    more,
    isLoading,
    isFresh,
    warmPaint,
    holdingMountedList,
    shieldRecords,
    presentationRevision,
    canAdvance,
    loadErrors,
  } = useRecordsRecentFeed(props, {
    available: hasRecordsNativeSnapshotSurface,
    bound: shieldBound,
  });
  useLayoutEffect(() => {
    suspension.update(
      (isFresh && !isLoading) || warmPaint,
      loadErrors.length > 0,
      records.length > 0,
    );
  });
  if (suspension.hidden && !holdingMountedList) return null;
  const covered = suspension.hidden || holdingMountedList;
  const inert = covered || warmPaint;
  // A retained, exactly bound native list remains painted for ordinary
  // multitasking. The native shield still conceals real protected-data loss.
  const hidePaint = covered && !(holdingMountedList && shieldBound);
  // A source failure must not add an error banner to records that are already usable.
  const hasRecords = records.length > 0;
  const statusAtTail = hasRecords && showAll;
  const status = (
    <>
      {isLoading &&
        (hasRecords || loadErrors.length === 0) &&
        (hasRecords ? (
          <RecordsRecentSourceState state="loading" onRetry={retrySources} />
        ) : (
          <RecordsRecentSkeleton />
        ))}
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
    <RecordsSnapshotSurface
      active={shieldRecords}
      onBound={setShieldBound}
      terminal={loadErrors.length > 0}
      neutralStyle={styles.container}
      neutral={
        <RecordsRecentSourceState
          state="failed"
          onRetry={retryProtectedPaint}
        />
      }
      revision={
        covered || (loadErrors.length > 0 && hasRecords)
          ? undefined
          : presentationRevision
      }
      pointerEvents={inert ? 'none' : 'auto'}
      accessibilityElementsHidden={inert}
      importantForAccessibility={inert ? 'no-hide-descendants' : 'auto'}
      style={[styles.container, hidePaint && styles.covered]}
      testID="records-recent-sources"
    >
      <View style={styles.headingRow}>
        <Text accessibilityRole="header" style={styles.heading}>
          {t('overview.recentRecord')}
        </Text>
        {!showAll && records.length > 0 && onViewAll ? (
          <AppButton
            accessibilityLabel={t('records.recent.viewAll')}
            onPress={() => !inert && isCurrent() && onViewAll()}
            size="compact"
            testID="records-recent-view-all"
            title={t('records.recent.viewAll') + '  ›'}
            variant="text"
          />
        ) : null}
      </View>
      {!inert && !statusAtTail ? status : null}
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
                {group.records.map(record => (
                  <RecordsRecentSourceEntry
                    key={`${record.kind}:${record.id}`}
                    documentIndex={record.documentIndex}
                    documentsOpening={documentsOpening}
                    groupLabel={group.label}
                    onOpen={() => {
                      if (!inert) openRecord(record);
                    }}
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
          disabled={inert || !canAdvance}
          onPress={() => {
            if (!inert) showMore();
          }}
        />
      ) : null}
      {!inert && statusAtTail ? status : null}
      {documentsOpening ? (
        <Text accessibilityLiveRegion="polite">
          {t('medicalDocument.source.opening')}
        </Text>
      ) : null}
    </RecordsSnapshotSurface>
  );
}

const styles = StyleSheet.create({
  container: { gap: hubSpacing.item, minWidth: 0 },
  covered: { opacity: 0 },
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
  rows: { gap: 6, minWidth: 0 },
});
