import 'react-native-get-random-values';
import { useEffect, useState } from 'react';
import { AppRegistry, StyleSheet, Text, View } from 'react-native';
import type { AppointmentRepository } from '@orot/storage';
import App from '../App';
import { name as appName } from '../app.json';
import AppointmentsScreen from '../src/appointments/AppointmentsScreen';
import { openLocalAppointmentRepository } from '../src/appointments/localRepository';

function AppointmentsProbeEntry() {
  const [repository, setRepository] = useState<AppointmentRepository | null>(null);
  const [failed, setFailed] = useState(false);
  const [showAppointments, setShowAppointments] = useState(true);

  useEffect(() => {
    let mounted = true;
    openLocalAppointmentRepository().then(
      value => {
        if (mounted) setRepository(value);
      },
      error => {
        console.error('Could not open local encrypted appointments storage:', error);
        if (mounted) setFailed(true);
      },
    );
    return () => {
      mounted = false;
    };
  }, []);

  if (!showAppointments) return <App />;
  if (repository) {
    return (
      <View style={styles.screen} testID="appointments-probe-ready">
        <AppointmentsScreen
          onBack={() => setShowAppointments(false)}
          repository={repository}
        />
      </View>
    );
  }

  const message = failed
    ? 'Could not open local encrypted appointments storage.'
    : 'Opening encrypted appointments storage.';

  return (
    <View style={styles.status}>
      <Text
        accessible
        accessibilityLabel={message}
        testID={failed ? 'appointments-probe-error' : 'appointments-probe-loading'}
      >
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  status: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#f7f8fa',
  },
});

AppRegistry.registerComponent(appName, () => AppointmentsProbeEntry);
