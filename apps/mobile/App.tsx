import { useState } from 'react';
import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import type { AppointmentRepository } from '@orot/storage';
import { appColors } from './src/layout/appColors';
import { CalendarAppRoute } from './src/calendar/CalendarAppRoute';
import { eventKitCalendarBridge } from './src/calendar/calendarBridge';
import type { CalendarBridge } from './src/calendar/types';
import RecordingScreen from './src/recording/RecordingScreen';
import { t } from './src/i18n';
import { CommonObservationsImportScreen } from './src/healthkit/commonObservations/CommonObservationsImportScreen';
import { commonObservationsCopy } from './src/healthkit/commonObservations/copy';
import type { CommonObservationsImportResult as CommonObservationsScreenResult } from './src/healthkit/commonObservations/CommonObservationsImportScreen';
import type { CommonObservationFeature } from './src/healthkit/commonObservations/types';
import { importLocalCommonObservations } from './src/healthkit/commonObservations/importLocal';
import { BloodPressureImportScreen } from './src/healthkit/bloodPressure/BloodPressureImportScreen';
import {
  importLocalBloodPressure,
  listLocalBloodPressureObservations,
} from './src/healthkit/bloodPressure/importLocal';
import type {
  BloodPressureObservation,
  BloodPressureSyncResult,
} from './src/healthkit/bloodPressure/types';
import WelcomeRoute from './src/routes/WelcomeRoute';
import { AiFeatureRoute } from './src/aiFeatures/integration';
import type { FeatureScreenRoute } from './src/aiFeatures/integration/aiFeatureNavigation';
import { NextVisitQuestionsRoute } from './src/aiFeatures/integration/NextVisitQuestionsRoute';
import { navigationText } from './src/i18n/navigation';
import type { VisitQuestionsRenderInput } from './src/aiFeatures/integration/AiFeatureFlowScreen';
import type { AiFeatureServiceDependencies } from './src/aiFeatures/integration/featureServices';
import {
  createNavigationController,
  NavigationRouteAdapter,
  useNavigationSnapshot,
} from './src/navigation';

type AppNavigationRoute =
  'home' | 'recording' | 'common-observations' | 'blood-pressure';

declare const require: (path: string) => {
  openLocalAppointmentRepository: () => Promise<AppointmentRepository>;
};

interface AppProps {
  loadAppointments?: () => Promise<AppointmentRepository>;
  calendarBridge?: CalendarBridge;
  importHealthObservations?: (
    features: readonly CommonObservationFeature[],
  ) => Promise<CommonObservationsScreenResult>;
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

export default function App({
  loadAppointments = defaultAppointmentLoader,
  calendarBridge = eventKitCalendarBridge,
  importHealthObservations = importLocalCommonObservations,
  importBloodPressure = importLocalBloodPressure,
  loadBloodPressureObservations = listLocalBloodPressureObservations,
  aiFeatureServiceDependencies,
  renderVisitQuestions,
}: AppProps) {
  // Start the guarded AI stack at the home card's destination so each action is one tap.
  const [aiInitialRoute, setAiInitialRoute] = useState<
    FeatureScreenRoute | 'provider-selection' | null
  >(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [appNavigation] = useState(() =>
    createNavigationController<AppNavigationRoute>('home'),
  );
  const appRoute = useNavigationSnapshot(appNavigation).currentRoute;
  // Keep only the selected display label in route state; selection identifiers stay in the provider store.
  const [selectedRecommendationProvider, setSelectedRecommendationProvider] =
    useState('');
  const [appointmentRepository, setAppointmentRepository] =
    useState<AppointmentRepository | null>(null);
  const [loadingAppointments, setLoadingAppointments] = useState(false);
  const [appointmentError, setAppointmentError] = useState('');

  async function openCalendar() {
    setShowCalendar(true);
    setAppointmentError('');
    if (appointmentRepository) return;

    setLoadingAppointments(true);
    try {
      setAppointmentRepository(await loadAppointments());
    } catch {
      setAppointmentError(t('appointments.openError'));
    } finally {
      setLoadingAppointments(false);
    }
  }

  async function openRecordingFromNavigation() {
    // Return through the active route guard before replacing a feature with recording.
    if (appNavigation.getSnapshot().currentRoute.name !== 'home') {
      const returnedHome = await appNavigation.requestHome();
      if (!returnedHome) return;
    }
    appNavigation.push('recording');
  }

  // Feature cards and provider settings share the guarded flow and local app services.
  if (aiInitialRoute)
    return (
      <AiFeatureRoute
        initialRoute={aiInitialRoute}
        onBack={() => setAiInitialRoute(null)}
        onOpenRecording={() => appNavigation.push('recording')}
        onProviderSelectionCommitted={(_, provider) =>
          setSelectedRecommendationProvider(provider.displayName)
        }
        renderVisitQuestions={
          renderVisitQuestions ??
          (input => <NextVisitQuestionsRoute {...input} />)
        }
        serviceDependencies={aiFeatureServiceDependencies}
      />
    );

  // Calendar keeps its current route boundary; a recording opened there returns to it.
  if (showCalendar && appRoute.name === 'home') {
    return (
      <CalendarAppRoute
        appointmentRepository={appointmentRepository}
        bridge={calendarBridge}
        appointmentError={appointmentError}
        loadingAppointments={loadingAppointments}
        onBack={() => setShowCalendar(false)}
        onOpenCalendar={openCalendar}
        onOpenRecording={() => {
          appNavigation.push('recording');
        }}
      />
    );
  }

  return (
    <NavigationRouteAdapter
      controller={appNavigation}
      scrollable={route =>
        route.name === 'home' || route.name === 'common-observations'
      }
      showHome={!showCalendar}
      primaryAction={
        appRoute.name === 'recording'
          ? undefined
          : {
              label: navigationText.recording.label,
              accessibilityLabel: navigationText.recording.accessibilityLabel,
              testID: 'navigation-recording',
              onPress: openRecordingFromNavigation,
            }
      }
    >
      {actions => {
        switch (actions.route.name) {
          case 'home':
            return (
              <WelcomeRoute
                selectedRecommendationProvider={selectedRecommendationProvider}
                onOpenProviderSelection={() =>
                  setAiInitialRoute('provider-selection')
                }
                onOpenVisitQuestions={() =>
                  setAiInitialRoute('visit-questions')
                }
                onOpenDiseaseHypotheses={() =>
                  setAiInitialRoute('disease-hypotheses')
                }
                onOpenRagConversation={() =>
                  setAiInitialRoute('rag-conversation')
                }
                onOpenExternalEvidence={() =>
                  setAiInitialRoute('external-evidence')
                }
                onOpenAppointments={openCalendar}
                onOpenCommonObservations={() =>
                  actions.push('common-observations')
                }
                onOpenBloodPressure={() => actions.push('blood-pressure')}
                onOpenRecording={() => actions.push('recording')}
              />
            );
          case 'recording':
            return <RecordingScreen onBack={actions.onBack} />;
          case 'common-observations':
            return (
              <View style={styles.commonObservationsContainer}>
                <CommonObservationsImportScreen
                  copy={commonObservationsCopy}
                  onImport={importHealthObservations}
                />
              </View>
            );
          case 'blood-pressure':
            return (
              <View style={styles.commonObservationsContainer}>
                <BloodPressureImportScreen
                  onBack={actions.onBack}
                  importBloodPressure={importBloodPressure}
                  loadObservations={loadBloodPressureObservations}
                />
              </View>
            );
        }
      }}
    </NavigationRouteAdapter>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  commonObservationsContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: appColors.background,
  },
});
