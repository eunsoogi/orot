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
import { loadRecordingSummaries } from './src/recording/loadRecordingSummaries';
import type { RecordingSourceRecord } from './src/recording/recordingTypes';
import { importLocalCommonObservations } from './src/healthkit/commonObservations/importLocal';
import type { CommonObservationsImportResult } from './src/healthkit/commonObservations/CommonObservationsImportScreen';
import type { CommonObservationFeature } from './src/healthkit/commonObservations/types';
import { importLocalBloodPressure } from './src/healthkit/bloodPressure/importLocal';
import type { BloodPressureSyncResult } from './src/healthkit/bloodPressure/types';
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

declare const require: (path: string) => {
  openLocalAppointmentRepository: () => Promise<AppointmentRepository>;
};

interface AppProps {
  loadAppointments?: () => Promise<AppointmentRepository>;
  loadRecordings?: () => Promise<readonly RecordingSourceRecord[]>;
  calendarBridge?: CalendarBridge;
  importHealthObservations?: (
    features: readonly CommonObservationFeature[],
  ) => Promise<CommonObservationsImportResult>;
  importBloodPressure?: () => Promise<BloodPressureSyncResult>;
  /** Keeps older blood-pressure fixtures working while the library uses one shared reader. */
  loadBloodPressureObservations?: () => Promise<readonly HealthObservation[]>;
  loadHealthObservations?: () => Promise<readonly HealthObservation[]>;
  loadHealthObservationPage?: (
    cursor: HealthObservationCursor | null,
  ) => Promise<HealthObservationPage>;
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
  importHealthObservations = importLocalCommonObservations,
  importBloodPressure = importLocalBloodPressure,
  loadBloodPressureObservations,
  loadHealthObservations,
  loadHealthObservationPage,
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
  const ai = useAppAiServices(aiFeatureServiceDependencies);
  const [activeTab, setActiveTab] = useState<AppRootTab>('home');
  const [selectedProvider, setSelectedProvider] = useState('');
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
      <AiFeatureSharedNavigationStateProvider>
        <NavigationRouteAdapter
          controller={appNavigation}
          scrollable={route =>
            route.name === 'common-observations' ||
            (route.name === 'home' &&
              ['home', 'records', 'settings'].includes(activeTab))
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
                manual={actions.route.name === 'medical-manual'}
                onOpenManual={() => actions.push('medical-manual')}
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
                selectedProvider={selectedProvider}
                serviceDependencies={aiFeatureServiceDependencies}
                onProviderSelectionCommitted={(_, provider) =>
                  setSelectedProvider(provider.displayName)
                }
                openProviderSettings={() =>
                  appNavigation.push('settings-provider')
                }
                openVisitQuestions={() => appNavigation.push('visit-questions')}
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
                importHealthObservations={importHealthObservations}
                importBloodPressure={importBloodPressure}
                loadHealthObservations={readHealthPage}
              />
            )
          }
        </NavigationRouteAdapter>
        {ai.disclosureSheet}
      </AiFeatureSharedNavigationStateProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  appShell: { flex: 1, backgroundColor: appColors.background },
});
