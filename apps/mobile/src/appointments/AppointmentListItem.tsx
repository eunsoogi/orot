import { Pressable } from 'react-native';
import type { Appointment } from '@orot/storage';
import { AppText as Text } from '../layout/AppText';
import { formatDateTime, t } from '../i18n';
import styles from './appointmentsStyles';
import {
  appointmentClinicName,
  appointmentStatusLabel,
} from './appointmentsPresentation';

interface AppointmentListItemProps {
  appointment: Appointment;
  history: boolean;
  nextVisit: boolean;
  selected: boolean;
  onSelect: () => void;
}

/** Separates the selectable detail record from the identity used as the next visit. */
export function AppointmentListItem({
  appointment,
  history,
  nextVisit,
  selected,
  onSelect,
}: AppointmentListItemProps) {
  const clinicName = appointmentClinicName(appointment);
  const dateTime = formatDateTime(new Date(appointment.effectiveAt));
  const status =
    history &&
    (appointment.status === 'scheduled' || appointment.status === 'rescheduled')
      ? t('appointments.status.past')
      : appointmentStatusLabel(appointment);
  const nextVisitLabel = t('appointments.nextVisit');
  const accessibilityLabel = [
    clinicName,
    dateTime,
    ...(nextVisit ? [nextVisitLabel] : []),
    status,
  ].join(', ');

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
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
      {nextVisit ? (
        <Text
          style={styles.nextVisitBadge}
          testID={`appointment-next-visit-${appointment.id}`}
        >
          {nextVisitLabel}
        </Text>
      ) : null}
      <Text style={history ? styles.historyStatus : undefined}>{status}</Text>
    </Pressable>
  );
}
