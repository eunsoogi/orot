import { useState, type ReactNode } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import type { AppointmentRepository } from '@orot/storage';
import CalendarLinkingScreen from './src/calendar/CalendarLinkingScreen';
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
import {
  HealthKitImportScreen,
  type UnifiedImportCoordinator,
} from './src/healthkit/unifiedImport/HealthKitImportScreen';
import { unifiedHealthImportCopy } from './src/healthkit/unifiedImport/copy';
import ProviderSelectionFlow from './src/providers/selection/ProviderSelectionFlow';
import { WelcomeHomeScreen } from './src/home/WelcomeHomeScreen';
import SafeAreaLayout from './src/layout/SafeAreaLayout';

declare const require: {
  (path: './src/appointments/localRepository'): {
    openLocalAppointmentRepository: () => Promise<AppointmentRepository>;
  };
  (path: './src/healthkit/unifiedImport/localImport'): {
    unifiedHealthImportCoordinator: UnifiedImportCoordinator;
  };
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
}: AppProps) {
  const [hasStarted, setHasStarted] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showCommonObservations, setShowCommonObservations] = useState(false);
  const [showBloodPressure, setShowBloodPressure] = useState(false);
  const [showUnifiedImport, setShowUnifiedImport] = useState(false);
  const [showRecording, setShowRecording] = useState(false);
  const [showProviderSelection, setShowProviderSelection] = useState(false);
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

  let routeContent: ReactNode,
    scrollable = false;

  if (showRecording) {
    routeContent = <RecordingScreen onBack={() => setShowRecording(false)} />;
  } else if (showCommonObservations) {
    scrollable = true;
    routeContent = (
      <View style={styles.commonObservationsContainer}>
        <Button
          onPress={() => setShowCommonObservations(false)}
          testID="common-observations-back"
          title={t('healthkit.commonObservations.back')}
        />
        <CommonObservationsImportScreen
          copy={commonObservationsCopy}
          onImport={importHealthObservations}
        />
      </View>
    );
  } else if (showUnifiedImport) {
    // This screen owns its scroller and gathers both selected providers in one action.
    routeContent = (
      <HealthKitImportScreen
        copy={unifiedHealthImportCopy}
        coordinator={defaultUnifiedImportCoordinator()}
        onBack={() => setShowUnifiedImport(false)}
      />
    );
  } else if (showBloodPressure) {
    // This dedicated path keeps paired readings and source-unit availability explicit.
    routeContent = (
      <View style={styles.commonObservationsContainer}>
        <BloodPressureImportScreen
          onBack={() => setShowBloodPressure(false)}
          importBloodPressure={importBloodPressure}
          loadObservations={loadBloodPressureObservations}
        />
      </View>
    );
  } else if (showProviderSelection) {
    // This flow owns its root insets, so it bypasses the shared layout below.
    return (
      <ProviderSelectionFlow
        onBack={() => setShowProviderSelection(false)}
        onSelectionCommitted={(_, provider) =>
          setSelectedRecommendationProvider(provider.displayName)
        }
      />
    );
  } else if (showCalendar && appointmentRepository) {
    routeContent = (
      <CalendarLinkingScreen
        repository={appointmentRepository}
        bridge={calendarBridge}
        onBack={() => setShowCalendar(false)}
        onOpenRecording={() => setShowRecording(true)}
      />
    );
  } else if (showCalendar) {
    scrollable = true;
    routeContent = (
      <View style={styles.container}>
        <Text accessibilityRole="header" style={styles.title}>
          {t('calendar.title')}
        </Text>
        <Text
          accessibilityRole={appointmentError ? 'alert' : undefined}
          testID="calendar-app-opening"
        >
          {appointmentError ||
            (loadingAppointments ? t('appointments.opening') : '')}
        </Text>
        {appointmentError ? (
          <Button
            onPress={openCalendar}
            testID="calendar-app-retry"
            title={t('appointments.retry')}
          />
        ) : null}
        <Button
          onPress={() => setShowCalendar(false)}
          testID="calendar-app-back"
          title={t('calendar.back')}
        />
      </View>
    );
  } else {
    scrollable = true;
    routeContent = (
      <WelcomeHomeScreen
        hasStarted={hasStarted}
        onGetStarted={() => setHasStarted(true)}
        onOpenAppointments={openCalendar}
        onOpenBloodPressure={() => setShowBloodPressure(true)}
        onOpenCommonObservations={() => setShowCommonObservations(true)}
        onOpenProviderSelection={() => setShowProviderSelection(true)}
        onOpenRecording={() => setShowRecording(true)}
        onOpenUnifiedImport={() => setShowUnifiedImport(true)}
        selectedRecommendationProvider={selectedRecommendationProvider}
      />
    );
  }

  return (
    <SafeAreaLayout scrollable={scrollable}>{routeContent}</SafeAreaLayout>
  );
}

function defaultUnifiedImportCoordinator() {
  // Defer native provider and database modules until the user opens this import route.
  return require('./src/healthkit/unifiedImport/localImport')
    .unifiedHealthImportCoordinator;
}

const styles = StyleSheet.create({
  commonObservationsContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#f7f8fa',
  },
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
    backgroundColor: '#f7f8fa',
  },
  title: {
    color: '#17212b',
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
});
