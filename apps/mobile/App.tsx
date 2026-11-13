import {
  defaultReminderAppointmentLoader,
  withAppointmentReminderApp,
} from './src/appointmentReminders/AppointmentReminderContext';
import { GatedReminderDeliveryHost } from './src/assistantAppearance/GatedReminderDeliveryHost';
import { RecordingSelectionProvider } from './src/recording/RecordingSelectionContext';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { useRecapRecovery } from './src/transcription/useRecapRecovery';
import { eventKitCalendarBridge } from './src/calendar/calendarBridge';
import { useCalendarAutoSync } from './src/calendar/useCalendarAutoSync';
import { loadRecordingSummaries } from './src/recording/loadRecordingSummaries';
import { AiFeatureSharedNavigationStateProvider } from './src/aiFeatures/integration/AiFeatureSharedNavigationState';
import {
  AppConversationScene,
  isAppAiRoute,
  useAppAiServices,
} from './src/routes/AppConversationScene';
import { renderVisitQuestionsRoute } from './src/routes/OverviewVisitQuestionsRoute';
import MedicalAppointmentRoute from './src/medicalAppointments/MedicalAppointmentRoute';
import {
  createNavigationController,
  NavigationRouteAdapter,
} from './src/navigation';
import { appContentLayoutOwner } from './src/navigation/appContentLayoutPolicy';
import type { NavigationRootTabs, AppRootTab } from './src/navigation/rootTabs';
import type { AppNavigationRoute } from './src/routes/AppRouteContent';
import { AppRouteContent } from './src/routes/AppRouteContent';
import type { AppProps } from './src/routes/AppEntryProps';
import { useAppOverviewData } from './src/routes/useAppOverviewData';
import { useOverviewActivity } from './src/routes/useOverviewActivity';
import { useBackupPreparation } from './src/backup/useBackupPreparation';
import { appColors } from './src/layout/appColors';
import { syncLocalPreviouslyRequestedHealthKit } from './src/healthkit/autoSyncLocal';
import { listLocalHealthObservationPage } from './src/healthkit/healthObservationLibrary';
import { healthObservationFixturePages } from './src/healthkit/healthObservationFixturePages';
import type { HealthRecordsDetailSelection } from './src/healthkit/healthRecordsLibraryModel';
import { resolveHealthRecordsMedicationLoader } from './src/healthkit/healthRecordsMedicationLibrary';
import { withAssistantAppearance } from './src/assistantAppearance/AssistantAppearanceProvider';

function App({
  loadAppointments = defaultReminderAppointmentLoader,
  loadRecordings = loadRecordingSummaries,
  calendarBridge = eventKitCalendarBridge,
  loadBloodPressureObservations,
  loadHealthObservations,
  loadHealthObservationPage,
  loadHealthRecordMedications,
  aiFeatureServiceDependencies,
  renderVisitQuestions,
  documentImportService,
}: AppProps) {
  const readHealthPage = useMemo(() => {
    if (loadHealthObservationPage) return loadHealthObservationPage;
    // Legacy injected fixtures remain supported; production always uses bounded SQL pages.
    const fixture = loadHealthObservations ?? loadBloodPressureObservations;
    return fixture
      ? healthObservationFixturePages(fixture)
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
  useRecapRecovery(ai.consent);
  const conversationSessionOptions = useMemo(
    () => ai.services.conversationSessionOptions(),
    [ai.services],
  );
  const calendarSync = useCalendarAutoSync(calendarBridge);
  const [activeTab, setActiveTab] = useState<AppRootTab>('conversation');
  const activeTabRef = useRef(activeTab);
  const selectActiveTab = (tab: AppRootTab) => {
    activeTabRef.current = tab;
    setActiveTab(tab);
  };
  const [selectedProvider, setSelectedProvider] = useState('');
  const [healthRecordDetailSelection, setHealthRecordDetailSelection] =
    useState<HealthRecordsDetailSelection | null>(null);
  const [appNavigation] = useState(() =>
    createNavigationController<AppNavigationRoute>('root'),
  );
  const homeData = useAppOverviewData(
    loadAppointments,
    loadRecordings,
    useOverviewActivity(appNavigation, activeTab),
  );
  const backupPreparation = useBackupPreparation();

  useEffect(() => {
    let previousState = AppState.currentState;
    // Launch and foreground refreshes query only categories with a prior explicit import request.
    syncLocalPreviouslyRequestedHealthKit();
    const subscription = AppState.addEventListener('change', nextState => {
      const returnedToForeground =
        (previousState === 'background' || previousState === 'inactive') &&
        nextState === 'active';
      previousState = nextState;
      if (returnedToForeground) {
        syncLocalPreviouslyRequestedHealthKit();
      }
    });
    return () => subscription.remove();
  }, []);

  function openRecording() {
    selectActiveTab('records');
    appNavigation.push('recording');
  }

  const rootTabs: NavigationRootTabs = {
    activeTab,
    onSelect: selectActiveTab,
  };

  return (
    <View style={styles.appShell}>
      <RecordingSelectionProvider>
        <AiFeatureSharedNavigationStateProvider
          conversationSessionOptions={conversationSessionOptions}
        >
          <NavigationRouteAdapter
            controller={appNavigation}
            // Root tabs share one scroll host; guarded detail routes own their scrollers.
            scrollable={route =>
              route.name === 'root' &&
              ['overview', 'records', 'settings'].includes(activeTab)
            }
            rootTabs={route => (route.name === 'root' ? rootTabs : undefined)}
            contentLayoutOwner={appContentLayoutOwner}
          >
            {/* Settings and AI use the same account services and persisted selection. */}
            {actions =>
              isAppAiRoute(actions.route.name) ||
              (actions.route.name === 'root' &&
                activeTab === 'conversation') ? (
                <AppConversationScene
                  actions={actions}
                  defaultConversation={actions.route.name === 'root'}
                  isEntryCurrent={() => {
                    const snapshot = appNavigation.getSnapshot();
                    return (
                      AppState.currentState === 'active' &&
                      !snapshot.isTransitioning &&
                      snapshot.currentRoute.key === actions.route.key &&
                      (actions.route.name !== 'root' ||
                        activeTabRef.current === 'conversation')
                    );
                  }}
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
                  {...homeData}
                  documentImportService={documentImportService}
                  loadSavedVisitQuestions={ai.services.loadSavedVisitQuestions}
                  actions={actions}
                  activeTab={activeTab}
                  selectTab={selectActiveTab}
                  backupPreparationState={backupPreparation.state}
                  retryBackupPreparation={backupPreparation.retry}
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
          <GatedReminderDeliveryHost
            controller={appNavigation}
            retention={conversationSessionOptions.retention}
            loadLocalData={aiFeatureServiceDependencies?.loadLocalData}
            selectTab={selectActiveTab}
          />
          {ai.disclosureSheet}
        </AiFeatureSharedNavigationStateProvider>
      </RecordingSelectionProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  appShell: { flex: 1, backgroundColor: appColors.background },
});
export default withAssistantAppearance(withAppointmentReminderApp(App));
