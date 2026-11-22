import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { MedicalDocumentSourceRecord } from '../medicalDocuments/medicalDocumentImportService';
import type { RecordingSourceRecord } from '../recording/recordingTypes';
import { AppText as Text } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import {
  buildRecentRecordEntries,
  groupRecentRecords,
  recentPageSize,
} from './RecordsRecentTimeline';
import { RecordsRecentSourceEntry } from './RecordsRecentSourceEntry';
import { RecordsRecentSourceState } from './RecordsRecentSourceState';
import type { GeneratedReportRow } from '../generatedReports/types';
import type { NavigationRouteOwnership } from '../navigation/navigationRouteContracts';
import type { RecordsTabAuthority } from './useAppRootTab';
import { useRecentSavedMaterial } from './useRecentSavedMaterial';
import { hubSpacing } from '../layout/hubSpacing';

interface RecordsRecentSourcesProps {
  readonly showAll?: boolean;
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
}

/** Renders actual local activity in one grouped timeline while preserving each existing destination. */
export function RecordsRecentSources({
  showAll = false,
  onViewAll,
  recordings,
  recordingState,
  documents,
  documentsState,
  documentsError,
  documentsOpening,
  onRetryRecordings,
  onRetryDocuments,
  onOpenMedicalDocument,
  onOpenSavedRecordings,
  onOpenRecording,
  onOpenReport,
  onOpenMemory,
  active = true,
  ownership,
  tabAuthority,
}: RecordsRecentSourcesProps) {
  const reports = useRecentSavedMaterial(
    active,
    ownership,
    undefined,
    showAll,
    Boolean(onOpenReport),
    tabAuthority,
  );
  const [limit, setLimit] = useState(recentPageSize);
  const records = useMemo(
    () => buildRecentRecordEntries(recordings, documents, reports.rows),
    [documents, recordings, reports.rows],
  );
  const availableLimit =
    reports.more && reports.rows.length > 0 && reports.state !== 'failed'
      ? Math.min(limit, reports.rows.length)
      : limit;
  const groups = groupRecentRecords(
    records,
    new Date(),
    showAll ? availableLimit : 3,
  );
  async function showMore() {
    if (!reports.isRouteCurrent()) return;
    // One cursor page is sufficient before revealing one more batch of mixed records.
    if (
      reports.more &&
      onOpenReport &&
      reports.rows.length < limit + recentPageSize &&
      reports.state !== 'failed' &&
      !(await reports.loadMore())
    )
      return;
    setLimit(value => value + recentPageSize);
  }
  const isLoading =
    recordingState === 'loading' ||
    documentsState === 'loading' ||
    reports.state === 'loading';
  const loadErrors = [
    reports.state === 'failed'
      ? t('records.recent.savedMaterialLoadError')
      : null,
    recordingState === 'failed' ? t('recording.library.loadError') : null,
    documentsState === 'failed'
      ? (documentsError ?? t('medicalDocument.source.loadError'))
      : null,
  ].filter((message): message is string => message !== null);

  function retrySources() {
    if (reports.state === 'failed') reports.loadMore();
    if (recordingState === 'failed') onRetryRecordings();
    if (documentsState === 'failed') onRetryDocuments();
  }

  return (
    <View style={styles.container} testID="records-recent-sources">
      <View style={styles.headingRow}>
        <Text accessibilityRole="header" style={styles.heading}>
          {t('overview.recentRecord')}
        </Text>
        {!showAll && records.length > 0 && onViewAll ? (
          <AppButton
            accessibilityLabel={t('records.recent.viewAll')}
            onPress={() => reports.isRouteCurrent() && onViewAll()}
            size="compact"
            testID="records-recent-view-all"
            title={t('records.recent.viewAll') + '  ›'}
            variant="text"
          />
        ) : null}
      </View>
      {isLoading ? (
        <RecordsRecentSourceState state="loading" onRetry={retrySources} />
      ) : null}
      {loadErrors.length > 0 ? (
        <RecordsRecentSourceState
          state="failed"
          errorMessage={loadErrors.join('\n')}
          onRetry={retrySources}
        />
      ) : null}
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
                    onOpen={() => {
                      if (!reports.isRouteCurrent()) return;
                      if (record.material) {
                        reports.open(record.material, item => {
                          if (item.origin === 'memory') onOpenMemory?.(item.id);
                          else onOpenReport?.(item);
                        });
                      } else if (record.kind === 'medical_document') {
                        onOpenMedicalDocument(record.id);
                      } else {
                        const source = recordings.find(
                          row => row.id === record.id,
                        );
                        if (source && onOpenRecording) onOpenRecording(source);
                        else onOpenSavedRecordings();
                      }
                    }}
                    record={record}
                  />
                ))}
              </View>
            </View>
          ))}
        </View>
      ) : null}
      {showAll &&
      (records.length > limit ||
        (onOpenReport && reports.more && reports.rows.length > 0)) ? (
        <AppButton
          testID="records-recent-show-more"
          title={t('records.recent.showMore')}
          disabled={reports.state === 'loading'}
          onPress={showMore}
        />
      ) : null}
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
