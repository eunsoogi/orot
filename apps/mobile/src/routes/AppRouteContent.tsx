import { AppointmentPreparationRoute } from '../appointmentReminders/AppointmentPreparationRoute';
import { useAppointmentReminderRuntime } from '../appointmentReminders/AppointmentReminderContext';
import { SymptomsRoute } from '../symptoms/SymptomsRoute';
import { RecordingReviewRoute } from './RecordingReviewRoute';
import RecordingScreen from '../recording/RecordingScreen';
import { transcriptEvidenceService } from '../transcription/transcriptEvidenceService';
import { t } from '../i18n';
import { UnifiedImportRoute } from '../healthkit/unifiedImport/UnifiedImportRoute';
import { RouteLoadError } from './RouteLoadError';
import WelcomeRoute from './WelcomeRoute';
import { SavedRecordingsRoute } from './SavedRecordingsRoute';
import { RecordsRoute } from './RecordsRoute';
import { ScheduleRoute } from './ScheduleRoute';
import { SettingsRoute } from './SettingsRoute';
import { SettingsDetailsRoute } from './SettingsDetailsRoute';
import { HealthRecordsRoute } from './HealthRecordsRoute';
import { ManualHistoryRoute } from './ManualHistoryRoute';
import { FeatureEntryScreen } from '../aiFeatures/FeatureEntryScreen';
import AppointmentsScreen from '../appointments/AppointmentsScreen';
import type { AppRouteContentProps } from './AppProps';
import { HealthReviewRoute } from '../healthReview/route';

export type { AppNavigationRoute } from './appNavigationRoute';

/** Renders the selected root or guarded detail within the shared navigation shell. */
export function AppRouteContent({
  loadSavedVisitQuestions,
  loadSymptoms,
  actions,
  activeTab,
  selectTab,
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
  openVisitQuestions,
  openDiseaseHypotheses,
  openRagConversation,
  openExternalEvidence,
  openRecording,
  loadHealthObservations,
  loadHealthRecordMedications,
  healthRecordDetailSelection,
  onHealthRecordDetailSelectionChange,
}: AppRouteContentProps) {
  const reminderRuntime = useAppointmentReminderRuntime();
  function openHomePreparation() {
    if (!nextAppointment || !reminderRuntime) return;
    // Bind the saved preparation page to the displayed visit, not the generator's different Calendar-only query.
    const route = actions.push('appointment-preparation');
    if (route)
      reminderRuntime.homePreparationTargets.set(route.key, nextAppointment.id);
  }
  if (actions.route.name === 'home') {
    switch (activeTab) {
      case 'home':
        return (
          <WelcomeRoute
            appointment={nextAppointment}
            appointmentState={appointmentState}
            recentRecording={recordings[0] ?? null}
            recordingState={recordingState}
            onRetryAppointments={() => refreshAppointments()}
            onRetryRecordings={() => refreshRecordings()}
            onPrepareVisit={openHomePreparation}
            onOpenSchedule={() => selectTab('schedule')}
            onOpenRecords={() => selectTab('records')}
            loadSymptoms={loadSymptoms}
            loadSavedVisitQuestions={loadSavedVisitQuestions}
            onOpenSymptoms={() => actions.push('symptoms')}
            onOpenRecording={openRecording}
          />
        );
      case 'records':
        return (
          <RecordsRoute
            recordings={recordings}
            recordingState={recordingState}
            onRetryRecordings={() => refreshRecordings()}
            onOpenSymptoms={() => actions.push('symptoms')}
            onOpenSavedRecordings={() => actions.push('saved-recordings')}
            onOpenRecording={openRecording}
            onOpenHealthLibrary={() => actions.push('health-records')}
            onOpenManualHistory={() => actions.push('manual-history')}
          />
        );
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
      case 'ai':
        return (
          <FeatureEntryScreen
            onOpenVisitQuestions={openVisitQuestions}
            onOpenDiseaseHypotheses={openDiseaseHypotheses}
            onOpenRagConversation={openRagConversation}
            onOpenExternalEvidence={openExternalEvidence}
            onOpenHealthReview={() => actions.push('health-review')}
          />
        );
      case 'settings':
        return (
          <SettingsRoute
            selectedProvider={selectedProvider}
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
    case 'health-review':
    case 'health-review-source':
      return <HealthReviewRoute actions={actions} />;
    case 'appointment-preparation':
      return (
        <AppointmentPreparationRoute
          routeKey={actions.route.key}
          loadSavedQuestions={loadSavedVisitQuestions}
        />
      );
    case 'unified-import':
      return (
        <UnifiedImportRoute onBack={actions.onBack} safeAreaHandledByParent />
      );
    case 'symptoms':
      return (
        <SymptomsRoute loadSymptoms={loadSymptoms} onBack={actions.onBack} />
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
