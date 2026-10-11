import { StyleSheet, View } from 'react-native';
import type { AppointmentRepository } from '@orot/storage';
import type { Appointment } from '@orot/storage';
import type { HealthObservation } from '@orot/domain';
import type { NavigationRouteActions } from '../navigation/NavigationRouteAdapter';
import type { AppRootTab } from '../navigation/rootTabs';
import { t } from '../i18n';
import { UnifiedImportRoute } from '../healthkit/unifiedImport/UnifiedImportRoute';
import { RouteLoadError } from './RouteLoadError';
import RecordingScreen from '../recording/RecordingScreen';
import { transcriptEvidenceService } from '../transcription/transcriptEvidenceService';
import type { RecordingSourceRecord } from '../recording/recordingTypes';
import type { CommonObservationsImportResult } from '../healthkit/commonObservations/CommonObservationsImportScreen';
import type { CommonObservationFeature } from '../healthkit/commonObservations/types';
import { CommonObservationsImportScreen } from '../healthkit/commonObservations/CommonObservationsImportScreen';
import { commonObservationsCopy } from '../healthkit/commonObservations/copy';
import { BloodPressureImportScreen } from '../healthkit/bloodPressure/BloodPressureImportScreen';
import { HealthRecordsLibraryScreen } from '../healthkit/HealthRecordsLibraryScreen';
import type { BloodPressureSyncResult } from '../healthkit/bloodPressure/types';
import WelcomeRoute from './WelcomeRoute';
import { RecordsRoute } from './RecordsRoute';
import { ScheduleRoute } from './ScheduleRoute';
import { SettingsRoute } from './SettingsRoute';
import { SettingsDetailsRoute } from './SettingsDetailsRoute';
import type { AppNavigationRoute } from './appNavigationRoute';
import { FeatureEntryScreen } from '../aiFeatures/FeatureEntryScreen';
import AppointmentsScreen from '../appointments/AppointmentsScreen';
import type { CalendarBridge } from '../calendar/types';
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
  readonly importHealthObservations: (
    features: readonly CommonObservationFeature[],
  ) => Promise<CommonObservationsImportResult>;
  readonly importBloodPressure: () => Promise<BloodPressureSyncResult>;
  readonly loadHealthObservations: () => Promise<readonly HealthObservation[]>;
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
  selectedProvider,
  serviceDependencies,
  onProviderSelectionCommitted,
  openProviderSettings,
  openVisitQuestions,
  openDiseaseHypotheses,
  openRagConversation,
  openExternalEvidence,
  openRecording,
  importHealthObservations,
  importBloodPressure,
  loadHealthObservations,
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
            refreshKey={recordingState}
            recordingState={recordingState}
            onRetry={() => refreshRecordings()}
            onOpenRecording={openRecording}
            onOpenUnifiedImport={() => actions.push('unified-import')}
            onOpenHealthImport={() => actions.push('common-observations')}
            onOpenHealthLibrary={() => actions.push('health-records')}
            onOpenBloodPressure={() => actions.push('blood-pressure')}
          />
        );
      case 'schedule':
        return (
          <ScheduleRoute
            appointmentRepository={appointmentRepository}
            appointmentState={appointmentState}
            bridge={calendarBridge}
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
          />
        );
    }
  }

  switch (actions.route.name) {
    case 'unified-import':
      return (
        <UnifiedImportRoute onBack={actions.onBack} safeAreaHandledByParent />
      );
    case 'recording':
      // The screen and review panel share one job registry to coalesce automatic and manual transcription.
      return (
        <RecordingScreen
          onBack={actions.onBack}
          transcriptService={transcriptEvidenceService}
        />
      );
    case 'common-observations':
      return (
        <View style={styles.container}>
          <CommonObservationsImportScreen
            copy={commonObservationsCopy}
            onImport={importHealthObservations}
          />
        </View>
      );
    case 'blood-pressure':
      return (
        <View style={styles.container}>
          <BloodPressureImportScreen
            onBack={actions.onBack}
            onOpenLibrary={() => actions.push('health-records')}
            importBloodPressure={importBloodPressure}
          />
        </View>
      );
    case 'health-records':
      return (
        <View style={styles.container}>
          <HealthRecordsLibraryScreen
            loadObservations={loadHealthObservations}
            onBack={actions.onBack}
          />
        </View>
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
      return (
        <SettingsDetailsRoute
          actions={actions}
          backupState={backupPreparationState}
          onPrepareBackup={retryBackupPreparation}
          onSelectionCommitted={onProviderSelectionCommitted}
          route={actions.route.name}
          serviceDependencies={serviceDependencies}
        />
      );
  }
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'flex-start', padding: 24 },
});
