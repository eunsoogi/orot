import { AppointmentQuestionRoutes } from './AppointmentQuestionRoutes';
import { useVisitDayQuestionsEntry } from './useVisitDayQuestionsEntry';
import { RecordsMaterialDestination } from './RecordsMaterialDestination';
import { SavedMemoryDetail } from '../memory/SavedMemoryDetail';
import { useRecordNav } from './RecordSourceNavigation';
import { MedicalDocumentDetailRoute } from './MedicalDocumentDetailRoute';
import { useIsFocused } from '@react-navigation/native';
import { RecordingReviewRoute } from './RecordingReviewRoute';
import RecordingScreen from '../recording/RecordingScreen';
import { transcriptEvidenceService } from '../transcription/transcriptEvidenceService';
import { t } from '../i18n';
import { RouteLoadError } from './RouteLoadError';
import OverviewRoute from './OverviewRoute';
import { SavedRecordingsRoute } from './SavedRecordingsRoute';
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
  recordsTabAuthority,
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
  const active = useIsFocused();
  const recordNav = useRecordNav(actions, active, recordsTabAuthority);
  const { sourceId, openMemory } = recordNav;
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
            onRetryAppointments={() => refreshAppointments()}
            onPrepareVisit={openOverviewPreparation}
            onOpenSchedule={() => actions.push('schedule')}
            onEditMetricSelection={() =>
              active &&
              actions.ownership?.isCurrent() !== false &&
              actions.push('overview-metric-selection')
            }
            loadSavedVisitQuestions={loadSavedVisitQuestions}
            discoverManualVisits={discoverManualVisits}
          />
        );
      case 'records':
        return (
          <RecordsRoute
            {...recordNav}
            onOpenGeneratedReports={() => actions.push('generated-reports')}
            memoryActive={active}
            onOpenRecentRecords={() => actions.push('recent-records')}
            onOpenSchedule={() => actions.push('schedule')}
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
            onOpenDisplayMode={() => actions.push('settings-display-mode')}
            onOpenNotifications={() => actions.push('settings-notifications')}
            onOpenMemory={() => actions.push('settings-memory')}
            onOpenPrivacy={() => actions.push('settings-privacy')}
            onOpenPrivacyPolicy={() => actions.push('settings-privacy-policy')}
            onOpenHealthData={() => actions.push('settings-health-data')}
            onOpenSyncStatus={() => actions.push('settings-sync-status')}
          />
        );
    }
  }
  switch (actions.route.name) {
    case 'schedule':
      return (
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
      );
    case 'visit-day-questions':
    case 'appointment-preparation':
      return (
        <AppointmentQuestionRoutes {...{ actions, loadSavedVisitQuestions }} />
      );
    case 'saved-memory-detail':
      return (
        <SavedMemoryDetail
          memoryId={sourceId}
          active={active}
          ownership={actions.ownership}
        />
      );
    case 'medical-document-detail':
      return (
        <MedicalDocumentDetailRoute
          active={active}
          ownership={actions.ownership}
          sourceId={sourceId}
          service={documentImportService}
          onBack={actions.onBack}
        />
      );
    case 'recent-records':
      // A native stack destination keeps the overview mounted and owns its own scroll position.
      return (
        <RecordsRoute
          {...recordNav}
          showAllRecent
          documentImportService={documentImportService}
          recordings={recordings}
          recordingState={recordingState}
          onRetryRecordings={() => refreshRecordings()}
          onOpenSavedRecordings={() => actions.push('saved-recordings')}
          onOpenRecording={openRecording}
          onOpenHealthLibrary={() => actions.push('health-records')}
        />
      );
    case 'saved-recordings':
      return <SavedRecordingsRoute actions={actions} />;
    case 'recording-review':
      return (
        <RecordingReviewRoute
          onBack={actions.onBack}
          routeKey={actions.route.key}
          routeOwner={actions.ownership}
        />
      );
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
    case 'generated-reports':
    case 'generated-report-detail':
    case 'generated-report-source': {
      // Keep the shared source callbacks and their precedence on all four routes.
      const props = { actions, onOpenMemory: openMemory, ...recordNav };
      return <RecordsMaterialDestination {...props} />;
    }
    case 'appointments':
      return appointmentRepository ? (
        <AppointmentsScreen
          fullNavigationLane
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
    case 'settings-privacy':
    case 'settings-privacy-policy':
    case 'settings-display-mode':
    case 'settings-notifications':
    case 'settings-memory':
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
