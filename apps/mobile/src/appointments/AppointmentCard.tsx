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

/** Keeps edit in the detail header and pairs reminder choices with confirmed cancellation. */
export default function AppointmentCard({
  appointment,
  onEdit,
  onCancel,
}: AppointmentCardProps) {
  const clinicName = appointmentClinicName(appointment);
  const canEdit =
    appointment.status === 'scheduled' || appointment.status === 'rescheduled';
  const formattedDateTime = formatDateTime(new Date(appointment.effectiveAt));
  // Match the reminder choices' two-line labels while the accessible name keeps the full wording.
  const cancelActionTitle = t('appointments.actions.cancel').replace(
    /\s+/u,
    '\n',
  );

  return (
    <View style={styles.card} testID={`appointment-${appointment.id}`}>
      <View
        style={styles.cardHeader}
        testID={`appointment-header-${appointment.id}`}
      >
        <Text
          style={[styles.clinic, styles.cardHeaderClinic]}
          testID={`appointment-clinic-${appointment.id}`}
        >
          {clinicName}
        </Text>
        {canEdit ? (
          <Button
            onPress={onEdit}
            size="compact"
            testID={`appointment-edit-${appointment.id}`}
            title={t('appointments.actions.edit')}
            variant="secondary"
          />
        ) : null}
      </View>
      <Text testID={`appointment-time-${appointment.id}`}>
        {formattedDateTime} · {t('appointments.localTime')}
      </Text>
      {appointment.note ? <Text>{appointment.note}</Text> : null}
      <Text testID={`appointment-status-${appointment.id}`}>
        {appointmentStatusLabel(appointment)}
      </Text>
      {canEdit ? (
        <View
          style={styles.actions}
          testID={`appointment-actions-${appointment.id}`}
        >
          <AppointmentReminderControls
            appointment={appointment}
            additionalAction={
              <Button
                accessibilityLabel={t('appointments.actions.cancelForClinic', {
                  clinic: clinicName,
                })}
                onPress={onCancel}
                size="compact"
                testID={`appointment-cancel-${appointment.id}`}
                title={cancelActionTitle}
                variant="destructive"
              />
            }
          />
        </View>
      ) : (
        <AppointmentReminderControls appointment={appointment} />
      )}
    </View>
  );
}
