import { RecordingSelectionProvider } from './src/recording/RecordingSelectionContext';
import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import type {
  AppointmentRepository,
  HealthObservationCursor,
  HealthObservationPage,
} from '@orot/storage';
import type { HealthObservation } from '@orot/domain';
import { eventKitCalendarBridge } from './src/calendar/calendarBridge';
import type { CalendarBridge } from './src/calendar/types';
import { useCalendarAutoSync } from './src/calendar/useCalendarAutoSync';
import { loadRecordingSummaries } from './src/recording/loadRecordingSummaries';
import type { RecordingSourceRecord } from './src/recording/recordingTypes';
import { AiFeatureSharedNavigationStateProvider } from './src/aiFeatures/integration/AiFeatureSharedNavigationState';
import {
  AppAiFeatureScene,
  isAppAiRoute,
  useAppAiServices,
} from './src/routes/AppAiFeatureScene';
import { renderVisitQuestionsRoute } from './src/aiFeatures/integration/NextVisitQuestionsRoute';
import MedicalAppointmentRoute from './src/medicalAppointments/MedicalAppointmentRoute';
import type { VisitQuestionsRenderInput } from './src/aiFeatures/integration/AiFeatureFlowScreen';
import type { AiFeatureServiceDependencies } from './src/aiFeatures/integration/featureServices';
import {
  createNavigationController,
  NavigationRouteAdapter,
} from './src/navigation';
import type { NavigationRootTabs, AppRootTab } from './src/navigation/rootTabs';
import type { AppNavigationRoute } from './src/routes/AppRouteContent';
import { AppRouteContent } from './src/routes/AppRouteContent';
import { useAppHomeData } from './src/routes/useAppHomeData';
import { useBackupPreparation } from './src/backup/useBackupPreparation';
import { appColors } from './src/layout/appColors';
import { syncLocalPreviouslyRequestedHealthKit } from './src/healthkit/autoSyncLocal';
import { listLocalHealthObservationPage } from './src/healthkit/healthObservationLibrary';
import type { HealthRecordsDetailSelection } from './src/healthkit/healthRecordsLibraryModel';
import type { HealthRecordsMedicationData } from './src/healthkit/healthRecordsMedicationLibrary';
import { resolveHealthRecordsMedicationLoader } from './src/healthkit/healthRecordsMedicationLibrary';

declare const require: (path: string) => {
  openLocalAppointmentRepository: () => Promise<AppointmentRepository>;
};

interface AppProps {
  loadAppointments?: () => Promise<AppointmentRepository>;
  loadRecordings?: () => Promise<readonly RecordingSourceRecord[]>;
  calendarBridge?: CalendarBridge;
  /** Keeps older blood-pressure fixtures working while the library uses one shared reader. */
  loadBloodPressureObservations?: () => Promise<readonly HealthObservation[]>;
  loadHealthObservations?: () => Promise<readonly HealthObservation[]>;
  loadHealthObservationPage?: (
    cursor: HealthObservationCursor | null,
  ) => Promise<HealthObservationPage>;
  loadHealthRecordMedications?: () => Promise<HealthRecordsMedicationData>;
  aiFeatureServiceDependencies?: AiFeatureServiceDependencies;
  /** Keeps App navigation real while E2E supplies deterministic synthetic visit-question operations. */
  renderVisitQuestions?: (input: VisitQuestionsRenderInput) => ReactElement;
}

function defaultAppointmentLoader(): Promise<AppointmentRepository> {
  return require('./src/appointments/localRepository').openLocalAppointmentRepository();
}

function defaultRecordingLoader(): Promise<readonly RecordingSourceRecord[]> {
  return loadRecordingSummaries();
}

export default function App({
  loadAppointments = defaultAppointmentLoader,
  loadRecordings = defaultRecordingLoader,
  calendarBridge = eventKitCalendarBridge,
  loadBloodPressureObservations,
  loadHealthObservations,
  loadHealthObservationPage,
  loadHealthRecordMedications,
  aiFeatureServiceDependencies,
  renderVisitQuestions,
}: AppProps) {
  const readHealthPage = useMemo(() => {
    if (loadHealthObservationPage) return loadHealthObservationPage;
    // Legacy injected fixtures remain supported; production always uses bounded SQL pages.
    const fixture = loadHealthObservations ?? loadBloodPressureObservations;
    return fixture
      ? async (cursor: HealthObservationCursor | null) => ({
          records: cursor ? [] : await fixture(),
          nextCursor: null,
        })
      : listLocalHealthObservationPage;
  }, [
    loadHealthObservationPage,
    loadHealthObservations,
    loadBloodPressureObservations,
  ]);
  const readHealthRecordMedications = resolveHealthRecordsMedicationLoader(
    loadHealthRecordMedications,
    Boolean(
      loadHealthObservationPage ||
      loadHealthObservations ||
      loadBloodPressureObservations,
    ),
  );
  const ai = useAppAiServices(aiFeatureServiceDependencies);
  const calendarSync = useCalendarAutoSync(calendarBridge);
  const [activeTab, setActiveTab] = useState<AppRootTab>('home');
  const [selectedProvider, setSelectedProvider] = useState('');
  const [healthRecordDetailSelection, setHealthRecordDetailSelection] =
    useState<HealthRecordsDetailSelection | null>(null);
  const [appNavigation] = useState(() =>
    createNavigationController<AppNavigationRoute>('home'),
  );
  const homeData = useAppHomeData(loadAppointments, loadRecordings);
  const backupPreparation = useBackupPreparation();

  useEffect(() => {
    let previousState = AppState.currentState;
    // Launch and foreground refreshes query only categories with a prior explicit import request.
    void syncLocalPreviouslyRequestedHealthKit();
    const subscription = AppState.addEventListener('change', nextState => {
      const returnedToForeground =
        (previousState === 'background' || previousState === 'inactive') &&
        nextState === 'active';
      previousState = nextState;
      if (returnedToForeground) {
        void syncLocalPreviouslyRequestedHealthKit();
      }
    });
    return () => subscription.remove();
  }, []);

  function openRecording() {
    setActiveTab('records');
    appNavigation.push('recording');
  }

  const rootTabs: NavigationRootTabs = {
    activeTab,
    onSelect: setActiveTab,
  };

  return (
    <View style={styles.appShell}>
      <RecordingSelectionProvider>
        <AiFeatureSharedNavigationStateProvider>
          <NavigationRouteAdapter
            controller={appNavigation}
            // Root tabs share one scroll host; guarded detail routes own their scrollers.
            scrollable={route =>
              route.name === 'home' &&
              ['home', 'records', 'settings'].includes(activeTab)
            }
            showHome
            homeAction={async () => {
              if (await appNavigation.requestHome()) setActiveTab('home');
            }}
            rootTabs={route => (route.name === 'home' ? rootTabs : undefined)}
          >
            {/* Settings and AI use the same account services and persisted selection. */}
            {actions =>
              isAppAiRoute(actions.route.name) ? (
                <AppAiFeatureScene
                  actions={actions}
                  consent={ai.consent}
                  services={ai.services}
                  renderVisitQuestions={
                    renderVisitQuestions ?? renderVisitQuestionsRoute
                  }
                  serviceDependencies={aiFeatureServiceDependencies}
                  onProviderSelectionCommitted={(_, provider) =>
                    setSelectedProvider(provider.displayName)
                  }
                />
              ) : actions.route.name === 'medical' ||
                actions.route.name === 'medical-manual' ? (
                <MedicalAppointmentRoute
                  bridge={calendarBridge}
                  calendarSync={calendarSync}
                  manual={actions.route.name === 'medical-manual'}
                  onOpenCalendarSettings={() =>
                    appNavigation.push('settings-sync-status')
                  }
                  onOpenManual={() => actions.push('medical-manual')}
                  onOpenProviderSelection={() =>
                    actions.push('settings-provider')
                  }
                  loadAppointments={loadAppointments}
                  selectedAiResolverOptions={
                    aiFeatureServiceDependencies?.selectedAi
                  }
                />
              ) : (
                <AppRouteContent
                  actions={actions}
                  activeTab={activeTab}
                  selectTab={setActiveTab}
                  appointmentRepository={homeData.appointmentRepository}
                  backupPreparationState={backupPreparation.state}
                  retryBackupPreparation={backupPreparation.retry}
                  appointmentState={homeData.appointmentState}
                  nextAppointment={homeData.nextAppointment}
                  recordings={homeData.recordings}
                  recordingState={homeData.recordingState}
                  refreshAppointments={homeData.refreshAppointments}
                  refreshRecordings={homeData.refreshRecordings}
                  calendarBridge={calendarBridge}
                  calendarSync={calendarSync}
                  selectedProvider={selectedProvider}
                  serviceDependencies={aiFeatureServiceDependencies}
                  onProviderSelectionCommitted={(_, provider) =>
                    setSelectedProvider(provider.displayName)
                  }
                  openProviderSettings={() =>
                    appNavigation.push('settings-provider')
                  }
                  openVisitQuestions={() =>
                    appNavigation.push('visit-questions')
                  }
                  openDiseaseHypotheses={() =>
                    appNavigation.push('disease-hypotheses')
                  }
                  openRagConversation={() =>
                    appNavigation.push('rag-conversation')
                  }
                  openExternalEvidence={() =>
                    appNavigation.push('external-evidence')
                  }
                  openRecording={openRecording}
                  loadHealthObservations={readHealthPage}
                  loadHealthRecordMedications={readHealthRecordMedications}
                  healthRecordDetailSelection={healthRecordDetailSelection}
                  onHealthRecordDetailSelectionChange={
                    setHealthRecordDetailSelection
                  }
                />
              )
            }
          </NavigationRouteAdapter>
          {ai.disclosureSheet}
        </AiFeatureSharedNavigationStateProvider>
      </RecordingSelectionProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  appShell: { flex: 1, backgroundColor: appColors.background },
});
