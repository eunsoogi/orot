import { StyleSheet, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { VerticalPageSections } from '../layout/VerticalPageSections';
import type { RecordingSourceRecord } from '../recording/recordingTypes';
import { MedicalDocumentSourceView } from '../medicalDocuments/MedicalDocumentSourceView';
import {
  MedicalDocumentReview,
  MedicalDocumentReviewPreview,
} from '../medicalDocuments/MedicalDocumentReview';
import { useMedicalDocumentImport } from '../medicalDocuments/useMedicalDocumentImport';
import type { MedicalDocumentImportService } from '../medicalDocuments/medicalDocumentImportService';
import { RecordsRecentSources } from './RecordsRecentSources';
import { hubSpacing } from '../layout/hubSpacing';
import { RecordsRouteEntries } from './RecordsRouteEntries';
import { LegacySymptomData } from './LegacySymptomData';

export interface RecordsRouteProps {
  readonly recordings: readonly RecordingSourceRecord[];
  readonly recordingState: 'loading' | 'ready' | 'failed';
  readonly onRetryRecordings: () => void;
  readonly onOpenSavedRecordings: () => void;
  readonly onOpenRecording: () => void;
  readonly onOpenHealthLibrary: () => void;
  readonly documentImportService?: MedicalDocumentImportService;
  readonly onOpenManualHistory: () => void;
}

/** Reuses Home's loaded audio snapshot and keeps every Records state in measured usable space. */
export function RecordsRoute({
  recordings,
  recordingState,
  onRetryRecordings,
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
    reloadSavedDocuments,
    saveMedicalDocument,
    selectMedicalDocument,
    savedDocuments,
    savedDocumentsState,
    savedDocumentsError,
    sourceDetail,
    sourceLoading,
    sourceMessage,
    stagedDocument,
  } = useMedicalDocumentImport(documentImportService);

  // Keep review actions before every extracted page inside the Records scene's single scroll owner.
  if (stagedDocument) {
    return (
      <VerticalPageSections
        primary={
          <MedicalDocumentReview
            document={stagedDocument}
            busy={activity !== null}
            message={message}
            onSave={saveMedicalDocument}
            onCancel={discardMedicalDocument}
          />
        }
        secondary={<MedicalDocumentReviewPreview document={stagedDocument} />}
        sectionGap={hubSpacing.item}
        testID="records-document-review-layout"
      />
    );
  }

  if (sourceDetail) {
    // The saved detail owns its measured panels so reflow keeps the text and Back state in place.
    return (
      <MedicalDocumentSourceView
        document={sourceDetail}
        onBack={closeSavedDocument}
      />
    );
  }

  return (
    <View style={styles.container}>
      <View testID="records-layout" style={styles.page}>
        <View style={styles.primaryPanel}>
          <RecordsRouteEntries
            onOpenSavedRecordings={onOpenSavedRecordings}
            onOpenRecording={onOpenRecording}
            onOpenHealthLibrary={onOpenHealthLibrary}
            onOpenManualHistory={onOpenManualHistory}
            medicalDocumentOpening={activity === 'selecting'}
            medicalDocumentDisabled={activity !== null}
            onImportMedicalDocument={selectMedicalDocument}
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
        <LegacySymptomData />
        <RecordsRecentSources
          recordings={recordings}
          recordingState={recordingState}
          documents={savedDocuments}
          documentsState={savedDocumentsState}
          documentsError={savedDocumentsError}
          documentsOpening={sourceLoading}
          onRetryRecordings={onRetryRecordings}
          onRetryDocuments={reloadSavedDocuments}
          onOpenMedicalDocument={openSavedDocument}
          onOpenSavedRecordings={onOpenSavedRecordings}
        />
        {sourceMessage ? (
          <Text
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            style={styles.status}
            testID="medical-document-source-status"
          >
            {sourceMessage}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    minWidth: 0,
    backgroundColor: appColors.background,
  },
  // A single page owns both entry groups; no panel seam adds a second top or side gutter.
  page: {
    gap: hubSpacing.item,
    paddingHorizontal: hubSpacing.horizontal,
    paddingTop: hubSpacing.top,
    paddingBottom: hubSpacing.bottom,
  },
  primaryPanel: { minWidth: 0, gap: hubSpacing.item },
  status: { color: appColors.secondary, fontSize: 14, lineHeight: 20 },
});
