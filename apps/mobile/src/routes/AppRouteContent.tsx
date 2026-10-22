import { RecordingReviewRoute } from './RecordingReviewRoute';
import RecordingScreen from '../recording/RecordingScreen';
import { transcriptEvidenceService } from '../transcription/transcriptEvidenceService';
import type { AppointmentRepository } from '@orot/storage';
import type { Appointment } from '@orot/storage';
import type { HealthObservationPageLoader } from '@orot/storage';
import type { NavigationRouteActions } from '../navigation/NavigationRouteAdapter';
import type { AppRootTab } from '../navigation/rootTabs';
import { t } from '../i18n';
import { UnifiedImportRoute } from '../healthkit/unifiedImport/UnifiedImportRoute';
import { RouteLoadError } from './RouteLoadError';
import type { RecordingSourceRecord } from '../recording/recordingTypes';
import type { HealthRecordsDetailSelection } from '../healthkit/healthRecordsLibraryModel';
import type { HealthRecordsMedicationLoader } from '../healthkit/healthRecordsMedicationLibrary';
import WelcomeRoute from './WelcomeRoute';
import { SavedRecordingsRoute } from './SavedRecordingsRoute';
import { RecordsRoute } from './RecordsRoute';
import { ScheduleRoute } from './ScheduleRoute';
import { SettingsRoute } from './SettingsRoute';
import { SettingsDetailsRoute } from './SettingsDetailsRoute';
import { HealthRecordsRoute } from './HealthRecordsRoute';
import type { AppNavigationRoute } from './appNavigationRoute';
import { FeatureEntryScreen } from '../aiFeatures/FeatureEntryScreen';
import AppointmentsScreen from '../appointments/AppointmentsScreen';
import type { CalendarBridge } from '../calendar/types';
import type { CalendarAutoSyncActions } from '../calendar/useCalendarAutoSync';
import type { BackupPreparationDisplayState } from '../backup/useBackupPreparation';
import type { AiFeatureServiceDependencies } from '../aiFeatures/integration/featureServices';
import type {
  ProviderSelection,
  ProviderSelectionOption,
} from '../providers/selection';

export type { AppNavigationRoute } from './appNavigationRoute';

interface AppRouteContentProps {
  readonly actions: NavigationRouteActions<AppNavigationRoute>;
  readonly activeTab: AppRootTab;
  readonly selectTab: (tab: AppRootTab) => void;
  readonly appointmentRepository: AppointmentRepository | null;
  readonly backupPreparationState: BackupPreparationDisplayState;
  readonly retryBackupPreparation: () => Promise<void>;
  readonly appointmentState: 'loading' | 'ready' | 'failed';
  readonly nextAppointment: Appointment | null;
  readonly recordings: readonly RecordingSourceRecord[];
  readonly recordingState: 'loading' | 'ready' | 'failed';
  readonly refreshAppointments: () => Promise<void>;
  readonly refreshRecordings: () => Promise<void>;
  readonly calendarBridge: CalendarBridge;
  readonly calendarSync: CalendarAutoSyncActions;
  readonly selectedProvider: string;
  readonly serviceDependencies?: AiFeatureServiceDependencies;
  readonly onProviderSelectionCommitted: (
    selection: ProviderSelection,
    provider: ProviderSelectionOption['provider'],
  ) => void;
  readonly openProviderSettings: () => void;
  readonly openVisitQuestions: () => void;
  readonly openDiseaseHypotheses: () => void;
  readonly openRagConversation: () => void;
  readonly openExternalEvidence: () => void;
  readonly openRecording: () => void;
  readonly loadHealthObservations: HealthObservationPageLoader;
  readonly loadHealthRecordMedications: HealthRecordsMedicationLoader;
  readonly healthRecordDetailSelection: HealthRecordsDetailSelection | null;
  readonly onHealthRecordDetailSelectionChange: (
    selection: HealthRecordsDetailSelection,
  ) => void;
}

/** Renders the selected root or guarded detail within the shared navigation shell. */
export function AppRouteContent({
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
            onPrepareVisit={openVisitQuestions}
            onOpenSchedule={() => selectTab('schedule')}
            onOpenRecords={() => selectTab('records')}
          />
        );
      case 'records':
        return (
          <RecordsRoute
            onOpenSavedRecordings={() => actions.push('saved-recordings')}
            onOpenRecording={openRecording}
            onOpenHealthLibrary={() => actions.push('health-records')}
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
