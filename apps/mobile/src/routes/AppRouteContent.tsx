import { StyleSheet, View } from 'react-native';
import type { AppointmentRepository } from '@orot/storage';
import type { Appointment } from '@orot/storage';
import type { NavigationRouteActions } from '../navigation/NavigationRouteAdapter';
import { useNavigationLeaveStateRegistration } from '../navigation';
import type { AppRootTab } from '../navigation/rootTabs';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import RecordingScreen from '../recording/RecordingScreen';
import type { RecordingSourceRecord } from '../recording/recordingTypes';
import type { CommonObservationsImportResult } from '../healthkit/commonObservations/CommonObservationsImportScreen';
import type { CommonObservationFeature } from '../healthkit/commonObservations/types';
import { CommonObservationsImportScreen } from '../healthkit/commonObservations/CommonObservationsImportScreen';
import { commonObservationsCopy } from '../healthkit/commonObservations/copy';
import { BloodPressureImportScreen } from '../healthkit/bloodPressure/BloodPressureImportScreen';
import type {
  BloodPressureObservation,
  BloodPressureSyncResult,
} from '../healthkit/bloodPressure/types';
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
  readonly loadBloodPressureObservations: () => Promise<
    readonly BloodPressureObservation[]
  >;
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
  loadBloodPressureObservations,
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
            onOpenHealthImport={() => actions.push('common-observations')}
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
    case 'recording':
      return <RecordingScreen onBack={actions.onBack} />;
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
            importBloodPressure={importBloodPressure}
            loadObservations={loadBloodPressureObservations}
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

function RouteLoadError({
  title,
  message,
  onRetry,
}: {
  readonly title: string;
  readonly message: string;
  readonly onRetry: () => void | Promise<unknown>;
}) {
  useNavigationLeaveStateRegistration({
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision: 0,
    inputRevision: 0,
  });
  return (
    <View style={styles.container}>
      <Text accessibilityRole="header">{title}</Text>
      <Text accessibilityRole="alert">{message}</Text>
      <AppButton
        onPress={onRetry}
        testID="route-load-retry"
        title={t('appointments.retry')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'flex-start', padding: 24 },
});
