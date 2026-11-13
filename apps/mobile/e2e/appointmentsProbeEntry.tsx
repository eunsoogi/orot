import 'react-native-get-random-values';
import { useEffect, useState } from 'react';
import { AppRegistry, StyleSheet, Text, View } from 'react-native';
import type { AppointmentRepository } from '@orot/storage';
import App from '../App';
import { name as appName } from '../app.json';
import ManualAppointmentScreen from '../src/medicalAppointments/ManualAppointmentScreen';
import { openLocalAppointmentRepository } from '../src/appointments/localRepository';
import { observeAppointmentCreates } from './observeAppointmentCreates';

function AppointmentsProbeEntry() {
  const [repository, setRepository] = useState<AppointmentRepository | null>(
    null,
  );
  const [failed, setFailed] = useState(false);
  const [showAppointments, setShowAppointments] = useState(true);
  const [createdIdentity, setCreatedIdentity] = useState('');

  useEffect(() => {
    let mounted = true;
    openLocalAppointmentRepository().then(
      value => {
        if (mounted) {
          setRepository(
            observeAppointmentCreates(value, id => {
              if (mounted) setCreatedIdentity(id);
            }),
          );
        }
      },
      error => {
        console.error(
          'Could not open local encrypted appointments storage:',
          error,
        );
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
      <>
        <ManualAppointmentScreen
          onBack={() => setShowAppointments(false)}
          repository={repository}
        />
        <View pointerEvents="none" style={styles.marker}>
          <Text
            accessible
            accessibilityLabel={createdIdentity}
            style={styles.markerText}
            testID="appointment-created-identity"
          >
            Appointment identity observation
          </Text>
        </View>
      </>
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
        testID={
          failed ? 'appointments-probe-error' : 'appointments-probe-loading'
        }
      >
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  marker: { position: 'absolute', left: 0, top: 0 },
  markerText: { fontSize: 1 },
  status: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#f7f8fa',
  },
});

AppRegistry.registerComponent(appName, () => AppointmentsProbeEntry);
