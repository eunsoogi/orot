import { useState } from 'react';
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
} from './RecordsRecentTimeline';
import { RecordsRecentSourceEntry } from './RecordsRecentSourceEntry';
import { RecordsRecentSourceState } from './RecordsRecentSourceState';
import { hubSpacing } from '../layout/hubSpacing';

interface RecordsRecentSourcesProps {
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
}

/** Renders actual local activity in one grouped timeline while preserving each existing destination. */
export function RecordsRecentSources({
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
}: RecordsRecentSourcesProps) {
  const [expanded, setExpanded] = useState(false);

  const records = buildRecentRecordEntries(recordings, documents);
  const groups = groupRecentRecords(records, new Date(), expanded ? null : 3);
  const isLoading =
    recordingState === 'loading' || documentsState === 'loading';
  // Independent source statuses must not replace records that loaded successfully.
  const loadErrors = [
    recordingState === 'failed' ? t('recording.library.loadError') : null,
    documentsState === 'failed'
      ? (documentsError ?? t('medicalDocument.source.loadError'))
      : null,
  ].filter((message): message is string => message !== null);

  function retrySources() {
    // Retry only the failed readers so successful and pending regions keep their state.
    if (recordingState === 'failed') onRetryRecordings();
    if (documentsState === 'failed') onRetryDocuments();
  }

  return (
    <View style={styles.container} testID="records-recent-sources">
      <View style={styles.headingRow}>
        <Text accessibilityRole="header" style={styles.heading}>
          {t('home.recentRecord')}
        </Text>
        {records.length > 0 ? (
          <AppButton
            accessibilityLabel={t(
              expanded ? 'records.recent.collapse' : 'records.recent.viewAll',
            )}
            onPress={() => setExpanded(value => !value)}
            size="compact"
            testID="records-recent-view-all"
            title={
              t(
                expanded ? 'records.recent.collapse' : 'records.recent.viewAll',
              ) + (expanded ? '  ⌃' : '  ›')
            }
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
                {group.records.map(record => {
                  const documentIndex =
                    record.kind === 'medical_document'
                      ? documents.findIndex(
                          document => document.id === record.id,
                        )
                      : undefined;

                  return (
                    <RecordsRecentSourceEntry
                      key={`${record.kind}:${record.id}`}
                      documentIndex={documentIndex}
                      documentsOpening={documentsOpening}
                      groupLabel={group.label}
                      onOpenMedicalDocument={onOpenMedicalDocument}
                      onOpenSavedRecordings={onOpenSavedRecordings}
                      record={record}
                    />
                  );
                })}
              </View>
            </View>
          ))}
        </View>
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
