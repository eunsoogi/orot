import { AppointmentReminderControls } from '../appointmentReminders/AppointmentReminderControls';
import { View } from 'react-native';
import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import type { Appointment } from '@orot/storage';
import { formatDateTime, t } from '../i18n';
import styles from './appointmentsStyles';
import {
  appointmentClinicName,
  appointmentStatusLabel,
} from './appointmentsPresentation';

interface AppointmentCardProps {
  appointment: Appointment;
  onEdit: () => void;
  onCancel: () => void;
}

/** Keeps the selected appointment's existing status, reminder, edit, and cancel actions together. */
export default function AppointmentCard({
  appointment,
  onEdit,
  onCancel,
}: AppointmentCardProps) {
  const clinicName = appointmentClinicName(appointment);
  const canEdit =
    appointment.status === 'scheduled' || appointment.status === 'rescheduled';
  const formattedDateTime = formatDateTime(new Date(appointment.effectiveAt));

  return (
    <View style={styles.card} testID={`appointment-${appointment.id}`}>
      <Text
        style={styles.clinic}
        testID={`appointment-clinic-${appointment.id}`}
      >
        {clinicName}
      </Text>
      <Text testID={`appointment-time-${appointment.id}`}>
        {formattedDateTime} · {t('appointments.localTime')}
      </Text>
      {appointment.note ? <Text>{appointment.note}</Text> : null}
      <Text testID={`appointment-status-${appointment.id}`}>
        {appointmentStatusLabel(appointment)}
      </Text>
      <AppointmentReminderControls appointment={appointment} />
      {canEdit ? (
        <View style={styles.actions}>
          <Button
            onPress={onEdit}
            testID={`appointment-edit-${appointment.id}`}
            title={t('appointments.actions.edit')}
          />
          <Button
            onPress={onCancel}
            testID={`appointment-cancel-${appointment.id}`}
            accessibilityLabel={t('appointments.actions.cancelForClinic', {
              clinic: clinicName,
            })}
            title={t('appointments.actions.cancel')}
          />
        </View>
      ) : null}
    </View>
  );
}
