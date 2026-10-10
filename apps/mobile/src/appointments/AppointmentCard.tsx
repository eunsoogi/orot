import { View } from 'react-native';
import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import type { Appointment } from '@orot/storage';
import { formatDateTime, t, type TranslationKey } from '../i18n';
import styles from './appointmentsStyles';

const statusKeys = {
  scheduled: 'appointments.status.scheduled',
  rescheduled: 'appointments.status.rescheduled',
  completed: 'appointments.status.completed',
  cancelled: 'appointments.status.cancelled',
} as const satisfies Record<Appointment['status'], TranslationKey>;

interface AppointmentCardProps {
  appointment: Appointment;
  onEdit: () => void;
  onCancel: () => void;
}

export default function AppointmentCard({
  appointment,
  onEdit,
  onCancel,
}: AppointmentCardProps) {
  const clinicName =
    appointment.clinicLabel ??
    appointment.reason ??
    t('appointments.fallbackTitle');
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
        {t(statusKeys[appointment.status])}
      </Text>
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
