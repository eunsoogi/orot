import { Pressable } from 'react-native';
import type { Appointment } from '@orot/storage';
import { AppText as Text } from '../layout/AppText';
import { formatDateTime } from '../i18n';
import styles from './appointmentsStyles';
import {
  appointmentClinicName,
  appointmentStatusLabel,
} from './appointmentsPresentation';

interface AppointmentListItemProps {
  appointment: Appointment;
  selected: boolean;
  onSelect: () => void;
}

/** Provides one accessible selection action for the appointment detail panel. */
export function AppointmentListItem({
  appointment,
  selected,
  onSelect,
}: AppointmentListItemProps) {
  const clinicName = appointmentClinicName(appointment);
  const dateTime = formatDateTime(new Date(appointment.effectiveAt));
  const status = appointmentStatusLabel(appointment);

  return (
    <Pressable
      accessibilityLabel={`${clinicName}, ${dateTime}, ${status}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onSelect}
      style={[
        styles.selectionCard,
        selected ? styles.selectionCardSelected : undefined,
      ]}
      testID={`appointment-select-${appointment.id}`}
    >
      <Text style={styles.clinic}>{clinicName}</Text>
      <Text>{dateTime}</Text>
      <Text>{status}</Text>
    </Pressable>
  );
}
