import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { SymptomEntry } from '@orot/storage';
import type { MedicalDocumentSourceRecord } from '../medicalDocuments/medicalDocumentImportService';
import { openLocalSymptomJournal } from '../symptoms/localRepository';
import type { SymptomJournalRepository } from '../symptoms/localRepository';
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
  readonly onOpenSymptoms: () => void;
  readonly loadSymptoms?: () => Promise<Pick<SymptomJournalRepository, 'list'>>;
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
  onOpenSymptoms,
  loadSymptoms = openLocalSymptomJournal,
}: RecordsRecentSourcesProps) {
  const [symptoms, setSymptoms] = useState<readonly SymptomEntry[]>([]);
  const [symptomState, setSymptomState] = useState<
    'loading' | 'ready' | 'failed'
  >('loading');
  const [symptomLoadAttempt, setSymptomLoadAttempt] = useState(0);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let active = true;
    setSymptoms([]);
    setSymptomState('loading');
    // The Records feed reads the existing encrypted journal and never writes or revises its entries.
    loadSymptoms()
      .then(repository => repository.list())
      .then(entries => {
        if (!active) return;
        setSymptoms(entries);
        setSymptomState('ready');
      })
      .catch(() => {
        if (!active) return;
        setSymptoms([]);
        setSymptomState('failed');
      });
    return () => {
      active = false;
    };
  }, [loadSymptoms, symptomLoadAttempt]);

  const records = buildRecentRecordEntries(recordings, documents, symptoms);
  const groups = groupRecentRecords(records, new Date(), expanded ? null : 3);
  const isLoading =
    recordingState === 'loading' ||
    documentsState === 'loading' ||
    symptomState === 'loading';
  const hasFailed =
    recordingState === 'failed' ||
    documentsState === 'failed' ||
    symptomState === 'failed';

  const feedState = isLoading ? 'loading' : hasFailed ? 'failed' : 'ready';

  function retrySources() {
    onRetryRecordings();
    onRetryDocuments();
    setSymptomLoadAttempt(attempt => attempt + 1);
  }

  return (
    <View style={styles.container} testID="records-recent-sources">
      <View style={styles.headingRow}>
        <Text accessibilityRole="header" style={styles.heading}>
          {t('home.recentRecord')}
        </Text>
        {!isLoading && !hasFailed && records.length > 0 ? (
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
      {feedState === 'loading' || feedState === 'failed' ? (
        <RecordsRecentSourceState
          state={feedState}
          errorMessage={
            documentsState === 'failed' ? documentsError : undefined
          }
          onRetry={retrySources}
        />
      ) : records.length === 0 ? (
        <RecordsRecentSourceState
          state="empty"
          showDocumentLibraryEmpty={documents.length === 0}
          onRetry={retrySources}
        />
      ) : (
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
                      onOpenSymptoms={onOpenSymptoms}
                      record={record}
                    />
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      )}
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
