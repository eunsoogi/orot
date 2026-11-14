import { NavigationInlineTransition } from '../navigation/NavigationInlineTransition';
import { useEffect } from 'react';
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
import { NAVIGATION_CONTENT_GAP } from '../navigation/navigationLayout';
import { useNavigationRouteScrollPosition } from '../navigation/NavigationRouteScrollView';
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
    setDeletionBusy,
    sourceDetail,
    sourceLoading,
    sourceMessage,
    stagedDocument,
  } = useMedicalDocumentImport(documentImportService);
  const routeScrollPosition = useNavigationRouteScrollPosition();
  useEffect(() => {
    // Source invalidation closes detail before file cleanup settles.
    if (activity === 'deleting' && !sourceDetail)
      routeScrollPosition?.restore();
  }, [activity, sourceDetail, routeScrollPosition]);

  function openSavedDocumentAtListPosition(sourceId: string) {
    // The root-tab ScrollView stays mounted while detail replaces the long Records list.
    routeScrollPosition?.preserve();
    openSavedDocument(sourceId);
  }

  function returnToRecordsList() {
    if (activity === 'deleting') return;
    closeSavedDocument();
    routeScrollPosition?.restore();
  }

  // Keep review actions before every extracted page inside the Records scene's single scroll owner.
  if (stagedDocument) {
    return (
      <NavigationInlineTransition
        transitionKey="review"
        style={styles.transition}
      >
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
      </NavigationInlineTransition>
    );
  }

  if (sourceDetail) {
    // The saved detail owns its measured panels so reflow keeps the text and Back state in place.
    return (
      <NavigationInlineTransition
        transitionKey="detail"
        style={styles.transition}
      >
        <MedicalDocumentSourceView
          document={sourceDetail}
          onBack={returnToRecordsList}
          onDeletionBusyChange={setDeletionBusy}
          onDeleted={() => {
            closeSavedDocument();
            routeScrollPosition?.restore();
            reloadSavedDocuments().catch(() => undefined);
          }}
        />
      </NavigationInlineTransition>
    );
  }

  return (
    <NavigationInlineTransition
      transitionKey="library"
      style={styles.transition}
    >
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
              onImportMedicalDocument={() => selectMedicalDocument('files')}
              onImportMedicalPhoto={() => selectMedicalDocument('photos')}
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
            documentsOpening={sourceLoading || activity === 'deleting'}
            onRetryRecordings={onRetryRecordings}
            onRetryDocuments={reloadSavedDocuments}
            onOpenMedicalDocument={openSavedDocumentAtListPosition}
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
    </NavigationInlineTransition>
  );
}

const styles = StyleSheet.create({
  transition: { flexGrow: 1, minWidth: 0 },
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
    // The route scroller already supplies the shared readable gap above navigation.
    paddingBottom: hubSpacing.bottom - NAVIGATION_CONTENT_GAP,
  },
  primaryPanel: { minWidth: 0, gap: hubSpacing.item },
  status: { color: appColors.secondary, fontSize: 14, lineHeight: 20 },
});
