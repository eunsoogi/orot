import { AppointmentReminderControls } from '../appointmentReminders/AppointmentReminderControls';
import { useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
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
  const { fontScale } = useWindowDimensions();
  const [headerWidth, setHeaderWidth] = useState<number>();
  // In a narrow card lane or at large text sizes, Edit must not consume title width.
  const stackedHeader =
    canEdit && (fontScale > 1.3 || (headerWidth != null && headerWidth < 300));
  const formattedDateTime = formatDateTime(new Date(appointment.effectiveAt));

  return (
    <View style={styles.card} testID={`appointment-${appointment.id}`}>
      <Text accessibilityRole="header" style={styles.cardEyebrow}>
        {t('appointments.detail.title')}
      </Text>
      <View
        onLayout={event => setHeaderWidth(event.nativeEvent.layout.width)}
        style={[styles.cardHeader, stackedHeader && headerStyles.stack]}
        testID={`appointment-header-${appointment.id}`}
      >
        <Text
          style={[
            styles.clinic,
            stackedHeader ? headerStyles.fullTitle : styles.cardHeaderClinic,
          ]}
          testID={`appointment-clinic-${appointment.id}`}
        >
          {clinicName}
        </Text>
        {canEdit ? (
          <Button
            onPress={onEdit}
            size="compact"
            style={stackedHeader && headerStyles.edit}
            testID={`appointment-edit-${appointment.id}`}
            title={t('appointments.actions.edit')}
            variant="secondary"
          />
        ) : null}
      </View>
      <View style={styles.cardFacts}>
        <Text
          style={styles.detailStatus}
          testID={`appointment-status-${appointment.id}`}
        >
          {appointmentStatusLabel(appointment)}
        </Text>
        <Text testID={`appointment-time-${appointment.id}`}>
          {formattedDateTime} · {t('appointments.localTime')}
        </Text>
        {appointment.note ? <Text>{appointment.note}</Text> : null}
      </View>
      <AppointmentReminderControls appointment={appointment} />
      {canEdit ? (
        <View
          style={styles.cancelAction}
          testID={`appointment-actions-${appointment.id}`}
        >
          <Button
            accessibilityLabel={t('appointments.actions.cancelForClinic', {
              clinic: clinicName,
            })}
            onPress={onCancel}
            size="compact"
            testID={`appointment-cancel-${appointment.id}`}
            title={t('appointments.actions.cancel')}
            variant="destructive"
          />
        </View>
      ) : null}
    </View>
  );
}

const headerStyles = StyleSheet.create({
  stack: { flexDirection: 'column' },
  fullTitle: { alignSelf: 'stretch', minWidth: 0 },
  edit: { maxWidth: '100%' },
});
