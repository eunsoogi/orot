import type { AppointmentRepository } from '@orot/storage';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import AppointmentsScreen from '../appointments/AppointmentsScreen';
import SafeAreaLayout from '../layout/SafeAreaLayout';
import { BottomNavigationMenu } from '../navigation/BottomNavigationMenu';

interface ManualAppointmentScreenProps {
  readonly repository: AppointmentRepository;
  readonly onBack: () => void;
}

/** Owns safe-area, keyboard, and shared back controls for the manual schedule route. */
export default function ManualAppointmentScreen({
  repository,
  onBack,
}: ManualAppointmentScreenProps) {
  return (
    <SafeAreaLayout>
      {/* Keep the shared bottom action above the keyboard and outside the form scroller. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.fill}
        testID="appointments-keyboard-root"
      >
        <AppointmentsScreen repository={repository} />
        <BottomNavigationMenu onBack={onBack} testID="appointments-back" />
      </KeyboardAvoidingView>
    </SafeAreaLayout>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
