import { useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import type { AppointmentRepository } from '@orot/storage';
import AppointmentsScreen from './src/appointments/AppointmentsScreen';
import { t } from './src/i18n';

declare const require: (path: string) => {
  openLocalAppointmentRepository: () => Promise<AppointmentRepository>;
};

interface AppProps {
  loadAppointments?: () => Promise<AppointmentRepository>;
}

function defaultAppointmentLoader(): Promise<AppointmentRepository> {
  return require('./src/appointments/localRepository').openLocalAppointmentRepository();
}

export default function App({
  loadAppointments = defaultAppointmentLoader,
}: AppProps) {
  const [hasStarted, setHasStarted] = useState(false);
  const [showAppointments, setShowAppointments] = useState(false);
  const [appointmentRepository, setAppointmentRepository] =
    useState<AppointmentRepository | null>(null);
  const [loadingAppointments, setLoadingAppointments] = useState(false);
  const [appointmentError, setAppointmentError] = useState('');

  async function openAppointments() {
    setShowAppointments(true);
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

  if (showAppointments) {
    if (appointmentRepository) {
      return (
        <AppointmentsScreen
          onBack={() => setShowAppointments(false)}
          repository={appointmentRepository}
        />
      );
    }
    return (
      <View style={styles.container}>
        <Text accessibilityRole="header" style={styles.title}>
          {t('appointments.title')}
        </Text>
        <Text
          testID="appointments-opening"
          accessibilityRole={appointmentError ? 'alert' : undefined}
        >
          {loadingAppointments ? t('appointments.opening') : appointmentError}
        </Text>
        {!loadingAppointments ? (
          <Button
            onPress={openAppointments}
            testID="appointments-retry-open"
            title={t('appointments.retry')}
          />
        ) : null}
        <Button
          onPress={() => setShowAppointments(false)}
          testID="appointments-back"
          title={t('appointments.back')}
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
      <Button
        onPress={() => setHasStarted(true)}
        testID="get-started"
        title={t('app.actions.getStarted')}
      />
      <Button
        onPress={openAppointments}
        testID="open-appointments"
        title={t('app.actions.appointments')}
      />
    </View>
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
  message: {
    color: '#45515f',
    fontSize: 16,
    textAlign: 'center',
  },
});
