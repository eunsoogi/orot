import { useState } from 'react';
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
import ProviderSelectionFlow from './src/providers/selection/ProviderSelectionFlow';
import { providerSelectionText } from './src/providers/selection/text';

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

  function openCommonObservations() {
    setShowCommonObservations(true);
  }

  if (showRecording) {
    return <RecordingScreen onBack={() => setShowRecording(false)} />;
  }

  if (showCommonObservations) {
    return (
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
  }

  if (showBloodPressure) {
    // This dedicated path keeps paired readings and source-unit availability explicit.
    return (
      <View style={styles.commonObservationsContainer}>
        <BloodPressureImportScreen
          onBack={() => setShowBloodPressure(false)}
          importBloodPressure={importBloodPressure}
          loadObservations={loadBloodPressureObservations}
        />
      </View>
    );
  }

  if (showProviderSelection) {
    return (
      <ProviderSelectionFlow
        onBack={() => setShowProviderSelection(false)}
        onSelectionCommitted={(_, provider) =>
          setSelectedRecommendationProvider(provider.displayName)
        }
      />
    );
  }

  if (showCalendar) {
    if (appointmentRepository) {
      return (
        <CalendarLinkingScreen
          repository={appointmentRepository}
          bridge={calendarBridge}
          onBack={() => setShowCalendar(false)}
          onOpenRecording={() => setShowRecording(true)}
        />
      );
    }

    return (
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
  }

  return (
    <View style={styles.container}>
      <Text
        accessibilityRole="header"
        style={styles.title}
        testID="welcome-title"
      >
        {t('app.welcome.title')}
      </Text>
      <Text style={styles.message}>
        {hasStarted ? t('app.welcome.started') : t('app.welcome.message')}
      </Text>
      {selectedRecommendationProvider ? (
        <Text testID="selected-recommendation-provider">
          {providerSelectionText.selectedPrefix}{' '}
          {selectedRecommendationProvider}
        </Text>
      ) : null}
      <Button
        onPress={() => setShowProviderSelection(true)}
        testID="open-provider-selection"
        title={providerSelectionText.title}
      />
      <Button
        onPress={() => setHasStarted(true)}
        testID="get-started"
        title={t('app.actions.getStarted')}
      />
      <Button
        onPress={openCalendar}
        testID="open-appointments"
        title={t('app.actions.appointments')}
      />
      <Button
        onPress={openCommonObservations}
        testID="open-common-observations"
        title={t('healthkit.commonObservations.open')}
      />
      <Button
        onPress={() => setShowBloodPressure(true)}
        testID="open-blood-pressure-import"
        title={t('healthkit.bloodPressure.open')}
      />
      <Button
        onPress={() => setShowRecording(true)}
        testID="open-recording"
        title={t('app.actions.recording')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  commonObservationsContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#f7f8fa',
  },
  container: {
    flex: 1,
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
  message: {
    color: '#45515f',
    fontSize: 16,
    textAlign: 'center',
  },
});
