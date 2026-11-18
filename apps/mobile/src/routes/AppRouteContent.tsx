import { AppointmentQuestionRoutes } from './AppointmentQuestionRoutes';
import { useVisitDayQuestionsEntry } from './useVisitDayQuestionsEntry';
import { SavedMemoryBrowser } from '../memory/SavedMemoryBrowser';
import { SavedMemoryDetail } from '../memory/SavedMemoryDetail';
import { useRecordSourceNavigation } from './RecordSourceNavigation';
import { MedicalDocumentDetailRoute } from './MedicalDocumentDetailRoute';
import { useOverviewReportEntry } from './useOverviewReportEntry';
import { useIsFocused } from '@react-navigation/native';
import { RecordingReviewRoute } from './RecordingReviewRoute';
import RecordingScreen from '../recording/RecordingScreen';
import { transcriptEvidenceService } from '../transcription/transcriptEvidenceService';
import { t } from '../i18n';
import { UnifiedImportRoute } from '../healthkit/unifiedImport/UnifiedImportRoute';
import { RouteLoadError } from './RouteLoadError';
import OverviewRoute from './OverviewRoute';
import { SavedRecordingsRoute } from './SavedRecordingsRoute';
import { RecordsHubSection } from './RecordsHubSection';
import { RecordsRoute } from './RecordsRoute';
import { ScheduleRoute } from './ScheduleRoute';
import { SettingsRoute } from './SettingsRoute';
import { SettingsDetailsRoute } from './SettingsDetailsRoute';
import { HealthRecordsRoute } from './HealthRecordsRoute';
import AppointmentsScreen from '../appointments/AppointmentsScreen';
import type { AppRouteContentProps } from './AppProps';
export type { AppNavigationRoute } from './appNavigationRoute';
/** Renders the selected root or guarded detail within the shared navigation shell. */
export function AppRouteContent({
  documentImportService,
  loadSavedVisitQuestions,
  discoverManualVisits,
  actions,
  activeTab,
  selectTab,
  onSelectRecordsSection,
  appointmentRepository,
  backupPreparationState,
  retryBackupPreparation,
  appointmentState,
  nextAppointment,
  recordings,
  recordingState,
  refreshAppointments,
  refreshRecordings,
  calendarBridge,
  calendarSync,
  selectedProvider,
  serviceDependencies,
  onProviderSelectionCommitted,
  openProviderSettings,
  openRecording,
  loadHealthObservations,
  loadHealthRecordMedications,
  healthRecordDetailSelection,
  onHealthRecordDetailSelectionChange,
}: AppRouteContentProps) {
  const { sourceId, openDocument, openMemory } =
    useRecordSourceNavigation(actions);
  const active = useIsFocused();
  const openOverviewReport = useOverviewReportEntry(
    active && activeTab === 'overview' && actions.route.name === 'root',
    () => selectTab('conversation'),
  );
  const openOverviewPreparation = useVisitDayQuestionsEntry(
    active,
    nextAppointment,
    actions,
  );
  if (actions.route.name === 'root') {
    switch (activeTab) {
      case 'overview':
        return (
          <OverviewRoute
            appointment={nextAppointment}
            appointmentState={appointmentState}
            recentRecording={recordings[0] ?? null}
            recordingState={recordingState}
            onRetryAppointments={() => refreshAppointments()}
            onRetryRecordings={() => refreshRecordings()}
            onPrepareVisit={openOverviewPreparation}
            onOpenSchedule={() => selectTab('schedule')}
            onOpenRecords={() => selectTab('records')}
            loadSavedVisitQuestions={loadSavedVisitQuestions}
            discoverManualVisits={discoverManualVisits}
            onOpenRecording={openRecording}
            onOpenDailyReport={openOverviewReport}
          />
        );
      case 'records':
        return (
          <RecordsHubSection
            selected="records"
            onSelect={onSelectRecordsSection}
          >
            <RecordsRoute
              onOpenDocumentDetail={openDocument}
              onOpenMemory={openMemory}
              memoryActive={active}
              onOpenRecentRecords={() => actions.push('recent-records')}
              documentImportService={documentImportService}
              recordings={recordings}
              recordingState={recordingState}
              onRetryRecordings={() => refreshRecordings()}
              onOpenSavedRecordings={() => actions.push('saved-recordings')}
              onOpenRecording={openRecording}
              onOpenHealthLibrary={() => actions.push('health-records')}
              onOpenManualHistory={() => actions.push('manual-history')}
            />
          </RecordsHubSection>
        );
      case 'schedule':
        return (
          <RecordsHubSection
            selected="schedule"
            onSelect={onSelectRecordsSection}
          >
            <ScheduleRoute
              appointmentRepository={appointmentRepository}
              appointmentState={appointmentState}
              bridge={calendarBridge}
              calendarSync={calendarSync}
              onRetry={() => refreshAppointments()}
              onOpenAppointments={() => actions.push('appointments')}
              onOpenMedicalAppointments={() => actions.push('medical')}
              onAppointmentsChanged={() => refreshAppointments()}
            />
          </RecordsHubSection>
        );
      case 'conversation':
        // AppConversationScene owns the root AI conversation and its app-lifetime sessions.
        return null;
      case 'settings':
        // Share the persisted selection and account services used by provider settings.
        return (
          <SettingsRoute
            selectedProvider={selectedProvider}
            selectedAiResolverOptions={serviceDependencies?.selectedAi}
            onOpenProviderSettings={openProviderSettings}
            onOpenAccounts={() => actions.push('settings-accounts')}
            onOpenPrivacy={() => actions.push('settings-privacy')}
            onOpenBackup={() => actions.push('settings-backup')}
            onOpenHealthData={() => actions.push('settings-health-data')}
            onOpenSyncStatus={() => actions.push('settings-sync-status')}
          />
        );
    }
  }
  switch (actions.route.name) {
    case 'visit-day-questions':
    case 'appointment-preparation':
      return (
        <AppointmentQuestionRoutes
          {...{ actions, selectTab, loadSavedVisitQuestions }}
        />
      );
    case 'unified-import':
      return (
        <UnifiedImportRoute onBack={actions.onBack} safeAreaHandledByParent />
      );
    case 'saved-memory-detail':
      return <SavedMemoryDetail memoryId={sourceId} active={active} />;
    case 'medical-document-detail':
      return (
        <MedicalDocumentDetailRoute
          sourceId={sourceId}
          service={documentImportService}
          onBack={actions.onBack}
        />
      );
    case 'recent-records':
      // A native stack destination keeps the overview mounted and owns its own scroll position.
      return (
        <RecordsRoute
          onOpenDocumentDetail={openDocument}
          onOpenMemory={openMemory}
          memoryActive={active}
          showAllRecent
          documentImportService={documentImportService}
          recordings={recordings}
          recordingState={recordingState}
          onRetryRecordings={() => refreshRecordings()}
          onOpenSavedRecordings={() => actions.push('saved-recordings')}
          onOpenRecording={openRecording}
          onOpenHealthLibrary={() => actions.push('health-records')}
          onOpenManualHistory={() => actions.push('manual-history')}
        />
      );
    case 'saved-recordings':
      return <SavedRecordingsRoute actions={actions} />;
    case 'recording-review':
      return <RecordingReviewRoute />;
    case 'recording':
      // Automatic and manual transcription share the same job registry inside the recording flow.
      return (
        <RecordingScreen
          onOpenSavedRecordings={() => actions.push('saved-recordings')}
          onBack={actions.onBack}
          transcriptService={transcriptEvidenceService}
        />
      );
    case 'health-records':
    case 'health-records-detail':
      return (
        <HealthRecordsRoute
          actions={actions}
          loadObservations={loadHealthObservations}
          loadMedicationData={loadHealthRecordMedications}
          route={actions.route.name}
          selection={healthRecordDetailSelection}
          onSelectionChange={onHealthRecordDetailSelectionChange}
        />
      );
    case 'manual-history':
      // Old in-memory routes no longer expose manual creation; originals live in Memory.
      return <SavedMemoryBrowser active={active} onOpenMemory={openMemory} />;
    case 'appointments':
      return appointmentRepository ? (
        <AppointmentsScreen
          active={active}
          repository={appointmentRepository}
          onAppointmentsChanged={() => refreshAppointments()}
        />
      ) : (
        <RouteLoadError
          title={t('appointments.title')}
          message={t('appointments.openError')}
          onRetry={() => refreshAppointments()}
        />
      );
    case 'settings-accounts':
    case 'settings-provider':
    case 'settings-backup':
    case 'settings-privacy':
    case 'settings-health-data':
    case 'settings-sync-status':
      return (
        <SettingsDetailsRoute
          actions={actions}
          backupState={backupPreparationState}
          calendarSync={calendarSync}
          onPrepareBackup={retryBackupPreparation}
          onSelectionCommitted={onProviderSelectionCommitted}
          route={actions.route.name}
          serviceDependencies={serviceDependencies}
        />
      );
  }
}
