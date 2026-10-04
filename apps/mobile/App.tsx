import { useCallback, useEffect, useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import type { AppointmentRepository } from '@orot/storage';
import CalendarLinkingScreen from './src/calendar/CalendarLinkingScreen';
import { eventKitCalendarBridge } from './src/calendar/calendarBridge';
import type { CalendarBridge } from './src/calendar/types';
import RecordingScreen from './src/recording/RecordingScreen';
import { t } from './src/i18n';

declare const require: (path: string) => {
  openLocalAppointmentRepository: () => Promise<AppointmentRepository>;
};

interface AppProps {
  loadAppointments?: () => Promise<AppointmentRepository>;
  calendarBridge?: CalendarBridge;
}

function defaultAppointmentLoader(): Promise<AppointmentRepository> {
  return require('./src/appointments/localRepository').openLocalAppointmentRepository();
}

export default function App({
  loadAppointments = defaultAppointmentLoader,
  calendarBridge = eventKitCalendarBridge,
}: AppProps) {
  const [appointmentRepository, setAppointmentRepository] =
    useState<AppointmentRepository | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [showRecording, setShowRecording] = useState(false);

  const loadRepository = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setAppointmentRepository(await loadAppointments());
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [loadAppointments]);

  useEffect(() => {
    loadRepository().catch(() => undefined);
  }, [loadRepository]);

  if (showRecording) {
    return <RecordingScreen onBack={() => setShowRecording(false)} />;
  }

  if (!appointmentRepository) {
    return (
      <View style={styles.container}>
        <Text accessibilityRole="header" style={styles.title}>
          {t('calendar.title')}
        </Text>
        <Text
          accessibilityRole={failed ? 'alert' : undefined}
          testID="calendar-app-opening"
        >
          {failed
            ? t('appointments.openError')
            : loading
              ? t('appointments.opening')
              : ''}
        </Text>
        {failed ? (
          <Button
            onPress={loadRepository}
            testID="calendar-app-retry"
            title={t('appointments.retry')}
          />
        ) : null}
      </View>
    );
  }

  return (
    <CalendarLinkingScreen
      repository={appointmentRepository}
      bridge={calendarBridge}
      onOpenRecording={() => setShowRecording(true)}
    />
  );
}

const styles = StyleSheet.create({
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
});
