import { View } from 'react-native';
import { AppButton as Button } from '../layout/AppButton';
import { t } from '../i18n';
import { medicalAppointmentCopy } from '../medicalAppointments/copy.ko';
import { calendarStyles as styles } from './calendarStyles';

interface CalendarQuickActionsProps {
  disabled: boolean;
  onOpenAppointments?: () => void;
  onOpenMedicalAppointments?: () => void;
}

/** Keeps the secondary schedule destinations available without pushing the month grid down. */
export function CalendarQuickActions({
  disabled,
  onOpenAppointments,
  onOpenMedicalAppointments,
}: CalendarQuickActionsProps) {
  const actions: Array<{ onPress: () => void; testID: string; title: string }> =
    [];
  if (onOpenAppointments) {
    actions.push({
      onPress: onOpenAppointments,
      testID: 'schedule-open-appointments',
      title: t('schedule.manageAppointments'),
    });
  }
  if (onOpenMedicalAppointments) {
    actions.push({
      onPress: onOpenMedicalAppointments,
      testID: 'open-medical-appointments',
      title: medicalAppointmentCopy.title,
    });
  }
  if (!actions.length) return null;

  return (
    <View style={styles.calendarQuickActions} testID="calendar-quick-actions">
      {actions.map(action => (
        <View key={action.testID} style={styles.calendarQuickActionCell}>
          <Button
            disabled={disabled}
            onPress={action.onPress}
            testID={action.testID}
            title={action.title}
            variant="secondary"
          />
        </View>
      ))}
    </View>
  );
}
