import { useState } from 'react';
import type { ReactElement } from 'react';
import type { AppointmentRepository } from '@orot/storage';
import { eventKitCalendarBridge } from './src/calendar/calendarBridge';
import type { CalendarBridge } from './src/calendar/types';
import { loadRecordingSummaries } from './src/recording/loadRecordingSummaries';
import type { RecordingSourceRecord } from './src/recording/recordingTypes';
import { importLocalCommonObservations } from './src/healthkit/commonObservations/importLocal';
import type { CommonObservationsImportResult } from './src/healthkit/commonObservations/CommonObservationsImportScreen';
import type { CommonObservationFeature } from './src/healthkit/commonObservations/types';
import {
  importLocalBloodPressure,
  listLocalBloodPressureObservations,
} from './src/healthkit/bloodPressure/importLocal';
import type {
  BloodPressureObservation,
  BloodPressureSyncResult,
} from './src/healthkit/bloodPressure/types';
import { AiFeatureRoute } from './src/aiFeatures/integration';
import type { FeatureScreenRoute } from './src/aiFeatures/integration/aiFeatureNavigation';
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
  loadBloodPressureObservations?: () => Promise<
    readonly BloodPressureObservation[]
  >;
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
  loadBloodPressureObservations = listLocalBloodPressureObservations,
  aiFeatureServiceDependencies,
  renderVisitQuestions,
}: AppProps) {
  const [aiInitialRoute, setAiInitialRoute] = useState<
    FeatureScreenRoute | 'provider-selection' | null
  >(null);
  const [activeTab, setActiveTab] = useState<AppRootTab>('home');
  const [selectedProvider, setSelectedProvider] = useState('');
  const [appNavigation] = useState(() =>
    createNavigationController<AppNavigationRoute>('home'),
  );
  const homeData = useAppHomeData(loadAppointments, loadRecordings);
  const backupPreparation = useBackupPreparation();

  function openRecording() {
    setActiveTab('records');
    appNavigation.push('recording');
  }

  const rootTabs: NavigationRootTabs = {
    activeTab,
    onSelect: setActiveTab,
  };

  if (aiInitialRoute) {
    return (
      <AiFeatureRoute
        initialRoute={aiInitialRoute}
        onBack={() => setAiInitialRoute(null)}
        onHome={() => {
          setAiInitialRoute(null);
          setActiveTab('home');
        }}
        onOpenRecording={() => {
          setAiInitialRoute(null);
          openRecording();
        }}
        onProviderSelectionCommitted={(_, provider) =>
          setSelectedProvider(provider.displayName)
        }
        renderVisitQuestions={renderVisitQuestions ?? renderVisitQuestionsRoute}
        serviceDependencies={aiFeatureServiceDependencies}
      />
    );
  }

  return (
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
        actions.route.name === 'medical' ||
        actions.route.name === 'medical-manual' ? (
          <MedicalAppointmentRoute
            bridge={calendarBridge}
            manual={actions.route.name === 'medical-manual'}
            onOpenManual={() => actions.push('medical-manual')}
            loadAppointments={loadAppointments}
            selectedAiResolverOptions={aiFeatureServiceDependencies?.selectedAi}
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
            openProviderSettings={() => setAiInitialRoute('provider-selection')}
            openVisitQuestions={() => setAiInitialRoute('visit-questions')}
            openDiseaseHypotheses={() =>
              setAiInitialRoute('disease-hypotheses')
            }
            openRagConversation={() => setAiInitialRoute('rag-conversation')}
            openExternalEvidence={() => setAiInitialRoute('external-evidence')}
            openRecording={openRecording}
            importHealthObservations={importHealthObservations}
            importBloodPressure={importBloodPressure}
            loadBloodPressureObservations={loadBloodPressureObservations}
          />
        )
      }
    </NavigationRouteAdapter>
  );
}
