import { useIsFocused } from '@react-navigation/native';
import { AppointmentPreparationRoute } from '../appointmentReminders/AppointmentPreparationRoute';
import { useAppointmentReminderRuntime } from '../appointmentReminders/AppointmentReminderContext';
import { canGenerateOverviewVisit } from './OverviewVisitQuestionsRoute';
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
import { ManualHistoryRoute } from './ManualHistoryRoute';
import AppointmentsScreen from '../appointments/AppointmentsScreen';
import type { AppRouteContentProps } from './AppProps';

export type { AppNavigationRoute } from './appNavigationRoute';

/** Renders the selected root or guarded detail within the shared navigation shell. */
export function AppRouteContent({
  documentImportService,
  loadSavedVisitQuestions,
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
  const active = useIsFocused();
  const reminderRuntime = useAppointmentReminderRuntime();
  function openOverviewPreparation() {
    if (!nextAppointment || !reminderRuntime) return;
    // Eligible visits retain the existing generator. Other visits keep exact-ID saved preparation and an explicit next action.
    const route = actions.push(
      canGenerateOverviewVisit(nextAppointment)
        ? 'visit-questions'
        : 'appointment-preparation',
    );
    if (route)
      reminderRuntime.overviewPreparationTargets.set(
        route.key,
        nextAppointment.id,
      );
  }
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
            onOpenRecording={openRecording}
            onOpenDailyReport={() => actions.push('daily-report')}
          />
        );
      case 'records':
        return (
          <RecordsHubSection
            selected="records"
            onSelect={onSelectRecordsSection}
          >
            <RecordsRoute
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
    case 'appointment-preparation':
      return (
        <AppointmentPreparationRoute
          routeKey={actions.route.key}
          loadSavedQuestions={loadSavedVisitQuestions}
          onOpenSchedule={async () => {
            if (await actions.onHome()) selectTab('schedule');
          }}
        />
      );
    case 'unified-import':
      return (
        <UnifiedImportRoute onBack={actions.onBack} safeAreaHandledByParent />
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
      return <ManualHistoryRoute onBack={actions.onBack} />;
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
