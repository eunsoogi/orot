import { RecordsPageBackdrop } from './RecordsPageBackdrop';
import { NavigationInlineTransition } from '../navigation/NavigationInlineTransition';
import { useContext, useEffect } from 'react';
import { View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { VerticalPageSections } from '../layout/VerticalPageSections';
import type { RecordingSourceRecord } from '../recording/recordingTypes';
import { MedicalDocumentSourceView } from '../medicalDocuments/MedicalDocumentSourceView';
import {
  MedicalDocumentReview,
  MedicalDocumentReviewPreview,
} from '../medicalDocuments/MedicalDocumentReview';
import { useMedicalDocumentImport } from '../medicalDocuments/useMedicalDocumentImport';
import type { MedicalDocumentImportService } from '../medicalDocuments/medicalDocumentImportService';
import { useRecordsSourcePaging } from './RecordsSourcePagingContext';
import { RecordsRecentSources } from './RecordsRecentSources';
import { RecentMaterialReadinessContext } from './RecentMaterialReadinessContext';
import { hubSpacing } from '../layout/hubSpacing';
import { useNavigationRouteScrollPosition } from '../navigation/NavigationRouteScrollView';
import { RecordsHeading, RecordsRouteEntries } from './RecordsRouteEntries';
import type { RecordsTabAuthority } from './useAppRootTab';
import type { NavigationRouteOwnership } from '../navigation/navigationRouteContracts';
import type { GeneratedReportRow } from '../generatedReports/types';
import { LegacySymptomData } from './LegacySymptomData';
import { recordsRouteStyles as styles } from './recordsRouteStyles';

export interface RecordsRouteProps {
  readonly memoryActive?: boolean;
  readonly onOpenGeneratedReports?: () => void;
  readonly onOpenDocumentDetail?: (sourceId: string) => void;
  readonly openDocument?: (sourceId: string) => void;
  readonly openRecentRecording?: (source: RecordingSourceRecord) => void;
  readonly openMemory?: (id: string) => void;
  readonly openReport?: (row: GeneratedReportRow) => boolean;
  readonly active?: boolean;
  readonly ownership?: NavigationRouteOwnership;
  readonly recordsTabAuthority?: RecordsTabAuthority;
  readonly showAllRecent?: boolean;
  readonly onOpenRecentRecords?: () => void;
  readonly onOpenSchedule?: () => void;
  readonly recordings: readonly RecordingSourceRecord[];
  readonly recordingState: 'loading' | 'ready' | 'failed';
  readonly onRetryRecordings: () => void;
  readonly onOpenSavedRecordings: () => void;
  readonly onOpenRecording: () => void;
  readonly onOpenHealthLibrary: () => void;
  readonly documentImportService?: MedicalDocumentImportService;
  readonly onOpenManualHistory?: () => void;
}

/** Reuses Home's loaded audio snapshot and keeps every Records state in measured usable space. */
export function RecordsRoute({
  openDocument,
  onOpenDocumentDetail = openDocument,
  openRecentRecording,
  openReport,
  openMemory,
  active = true,
  ownership,
  recordsTabAuthority,
  onOpenGeneratedReports,
  memoryActive = true,
  showAllRecent = false,
  onOpenRecentRecords,
  onOpenSchedule,
  recordings,
  recordingState,
  onRetryRecordings,
  onOpenSavedRecordings,
  onOpenRecording,
  onOpenHealthLibrary,
  documentImportService,
  onOpenManualHistory,
}: RecordsRouteProps) {
  const pagedAudio = useRecordsSourcePaging();
  const pagedDocuments = pagedAudio && !documentImportService;
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
  } = useMedicalDocumentImport(documentImportService, !pagedDocuments);
  const routeScrollPosition = useNavigationRouteScrollPosition();
  const recentMaterialReadyLease = useContext(RecentMaterialReadinessContext);
  useEffect(() => {
    // Source invalidation closes detail before file cleanup settles.
    if (activity === 'deleting' && !sourceDetail)
      routeScrollPosition?.restore();
  }, [activity, sourceDetail, routeScrollPosition]);

  function openSavedDocumentAtListPosition(sourceId: string) {
    if (onOpenDocumentDetail) {
      onOpenDocumentDetail(sourceId);
      return;
    }
    routeScrollPosition?.preserve();
    openSavedDocument(sourceId);
  }

  function returnToRecordsList() {
    if (activity === 'deleting') return;
    closeSavedDocument();
    routeScrollPosition?.restore();
  }

  if (stagedDocument) {
    return (
      <NavigationInlineTransition
        transitionKey="review"
        depth={1}
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
    return (
      <NavigationInlineTransition
        transitionKey="detail"
        depth={1}
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
        {!showAllRecent ? <RecordsPageBackdrop /> : null}
        <View testID="records-layout" style={styles.page}>
          {!showAllRecent ? (
            <RecordsHeading onOpenRecording={onOpenRecording} />
          ) : null}
          <RecordsRecentSources
            showAll={showAllRecent}
            recentMaterialReadyLease={recentMaterialReadyLease}
            pagedAudio={pagedAudio}
            pagedDocuments={pagedDocuments}
            onViewAll={onOpenRecentRecords}
            recordings={recordings}
            recordingState={recordingState}
            documents={savedDocuments}
            documentsState={savedDocumentsState}
            documentsError={savedDocumentsError}
            documentsOpening={sourceLoading || activity === 'deleting'}
            onRetryRecordings={onRetryRecordings}
            onRetryDocuments={reloadSavedDocuments}
            onOpenMedicalDocument={openSavedDocumentAtListPosition}
            onOpenRecording={openRecentRecording}
            onOpenReport={openReport}
            onOpenMemory={openMemory}
            active={active}
            ownership={ownership}
            tabAuthority={recordsTabAuthority}
            onOpenSavedRecordings={onOpenSavedRecordings}
          />
          {!showAllRecent ? (
            <View style={styles.primaryPanel}>
              <RecordsRouteEntries
                materialsActive={memoryActive}
                onOpenGeneratedReports={onOpenGeneratedReports}
                onOpenSavedRecordings={onOpenSavedRecordings}
                onOpenSchedule={onOpenSchedule}
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
          ) : null}
          {!showAllRecent ? <LegacySymptomData /> : null}
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
