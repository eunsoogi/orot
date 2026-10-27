import { StyleSheet, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import type { RecordingSourceRecord } from '../recording/recordingTypes';
import { MedicalDocumentImportAction } from '../medicalDocuments/MedicalDocumentImportAction';
import {
  MedicalDocumentSourceLibrary,
  MedicalDocumentSourceView,
} from '../medicalDocuments/MedicalDocumentSourceView';
import { MedicalDocumentReview } from '../medicalDocuments/MedicalDocumentReview';
import { useMedicalDocumentImport } from '../medicalDocuments/useMedicalDocumentImport';
import type { MedicalDocumentImportService } from '../medicalDocuments/medicalDocumentImportService';
import { RecordsRecentSources } from './RecordsRecentSources';
import { RecordsRouteEntries } from './RecordsRouteEntries';

export interface RecordsRouteProps {
  readonly recordings: readonly RecordingSourceRecord[];
  readonly recordingState: 'loading' | 'ready' | 'failed';
  readonly onRetryRecordings: () => void;
  readonly onOpenSymptoms: () => void;
  readonly onOpenSavedRecordings: () => void;
  readonly onOpenRecording: () => void;
  readonly onOpenHealthLibrary: () => void;
  readonly documentImportService?: MedicalDocumentImportService;
  readonly onOpenManualHistory: () => void;
}

/** Reuses Home's loaded audio snapshot while keeping medical import review full-screen. */
export function RecordsRoute({
  recordings,
  recordingState,
  onRetryRecordings,
  onOpenSymptoms,
  onOpenSavedRecordings,
  onOpenRecording,
  onOpenHealthLibrary,
  documentImportService,
  onOpenManualHistory,
}: RecordsRouteProps) {
  const {
    activity,
    closeSavedDocument,
    discardMedicalDocument,
    message,
    openSavedDocument,
    saveMedicalDocument,
    selectMedicalDocument,
    savedDocuments,
    savedDocumentsLoading,
    sourceDetail,
    sourceLoading,
    sourceMessage,
    stagedDocument,
  } = useMedicalDocumentImport(documentImportService);

  if (stagedDocument) {
    return (
      <MedicalDocumentReview
        document={stagedDocument}
        busy={activity !== null}
        message={message}
        onSave={saveMedicalDocument}
        onCancel={discardMedicalDocument}
      />
    );
  }

  if (sourceDetail) {
    return (
      <MedicalDocumentSourceView
        document={sourceDetail}
        onBack={closeSavedDocument}
      />
    );
  }

  return (
    <View style={styles.container}>
      <AdaptiveColumns
        primary={
          <View style={styles.primaryPanel}>
            <RecordsRouteEntries
              onOpenSymptoms={onOpenSymptoms}
              onOpenSavedRecordings={onOpenSavedRecordings}
              onOpenRecording={onOpenRecording}
              onOpenHealthLibrary={onOpenHealthLibrary}
              onOpenManualHistory={onOpenManualHistory}
            />
            {/* Imported clinical sources stay in their explicit review workflow. */}
            <View style={styles.medicalDocuments}>
              <MedicalDocumentImportAction
                opening={activity === 'selecting'}
                disabled={activity !== null}
                onPress={selectMedicalDocument}
              />
              <MedicalDocumentSourceLibrary
                documents={savedDocuments}
                loading={savedDocumentsLoading}
                openingSource={sourceLoading}
                message={sourceMessage}
                onOpenDocument={openSavedDocument}
              />
              {message ? (
                <Text
                  accessibilityLiveRegion="polite"
                  style={styles.status}
                  testID="medical-document-import-status"
                >
                  {message}
                </Text>
              ) : null}
            </View>
          </View>
        }
        secondary={
          <RecordsRecentSources
            recordings={recordings}
            recordingState={recordingState}
            onRetry={onRetryRecordings}
            onOpenSavedRecordings={onOpenSavedRecordings}
          />
        }
        testID="records-layout"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    minWidth: 0,
    backgroundColor: appColors.background,
  },
  primaryPanel: { flexGrow: 1, minWidth: 0 },
  medicalDocuments: {
    gap: 16,
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  status: { color: appColors.secondary, fontSize: 14, lineHeight: 20 },
});
