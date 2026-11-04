import { AppointmentReminderControls } from '../appointmentReminders/AppointmentReminderControls';
import { Pressable, View } from 'react-native';
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

/** Keeps reminder choices and editing secondary while isolating destructive cancellation. */
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
        <View
          style={styles.actions}
          testID={`appointment-actions-${appointment.id}`}
        >
          <View
            style={styles.actionDivider}
            testID={`appointment-action-divider-edit-${appointment.id}`}
          />
          <View style={styles.editAction}>
            <Button
              onPress={onEdit}
              size="compact"
              testID={`appointment-edit-${appointment.id}`}
              title={t('appointments.actions.edit')}
              variant="secondary"
            />
          </View>
          <View
            style={styles.actionDivider}
            testID={`appointment-action-divider-cancel-${appointment.id}`}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('appointments.actions.cancelForClinic', {
              clinic: clinicName,
            })}
            onPress={onCancel}
            style={styles.cancelAction}
            testID={`appointment-cancel-${appointment.id}`}
          >
            <Text style={styles.cancelActionText}>
              {t('appointments.actions.cancel')}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
