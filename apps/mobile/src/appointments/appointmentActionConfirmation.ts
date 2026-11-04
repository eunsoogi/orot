import { Alert } from 'react-native';
import type { Appointment } from '@orot/storage';
import { t } from '../i18n';
import { appointmentClinicName } from './appointmentsPresentation';

/** Opens native destructive confirmation and runs cancellation only after explicit confirmation. */
export function requestAppointmentCancellationConfirmation(
  appointment: Appointment,
  onConfirm: () => void,
): void {
  Alert.alert(
    t('appointments.cancelConfirmation.title'),
    t('appointments.cancelConfirmation.message', {
      clinic: appointmentClinicName(appointment),
    }),
    [
      {
        text: t('appointments.cancelConfirmation.keep'),
        style: 'cancel',
      },
      {
        text: t('appointments.actions.cancel'),
        style: 'destructive',
        onPress: onConfirm,
      },
    ],
    { cancelable: false },
  );
}
